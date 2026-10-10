# Human Harness — Plan 1: Node foundations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pnpm monorepo where a harness (manifest + AGENTS.md + blocks) can run a full turn against Claude or Codex from the terminal, with blocks delivered through MCP, a managed AGENTS.md, and automatic local history with rollback — all plain Node, fully tested with fake agents.

**Architecture:** `harness-sdk` defines the manifest and blocks. `engines` is a data registry with legal status. `workspace` prepares the user folder, writes instructions and keeps a hidden git history (isomorphic-git). `blocks` runs a `ui` MCP server that forwards validated block calls to the runtime over a local socket ("bridge"). `runtime` exposes one `Transport` interface with two implementations — `claude-cli` (spawns the unmodified `claude -p` binary per turn) and `acp` (long-lived ACP agent such as `codex-acp`) — and orchestrates turns with history snapshots. `fake-agent` provides scripted stand-ins for both CLIs so everything is tested without subscriptions.

**Tech Stack:** Node ≥ 22, pnpm 12 workspaces, TypeScript 7, Vitest 5, tsx 4, zod 4, isomorphic-git 1.43, @modelcontextprotocol/sdk 1.32, @agentclientprotocol/sdk 1.8.

Spec: `docs/superpowers/specs/2026-10-10-humanharness-core-design.md`. Roadmap: `docs/superpowers/plans/2026-10-10-00-roadmap.md`.

---

## Conventions

- All code, comments, docs and commit messages in English.
- Packages expose TypeScript source directly (`"exports": { ".": "./src/index.ts" }`); child processes run TS through tsx. Building to JS is plan 4's job.
- Imports between files are extensionless (`moduleResolution: "bundler"`).
- Tests live in `packages/<name>/test/*.test.ts` and use real temp folders (`fs.mkdtempSync(path.join(os.tmpdir(), "hh-"))`).
- Run everything from the repo root. One commit per task (more if a step says so).
- Compliance rules from spec §5 apply to every line: never read `~/.claude` / `~/.codex`, never inject or strip credentials/env auth variables, never patch binaries.

## File map

```
package.json, pnpm-workspace.yaml, tsconfig.json, vitest.config.ts, .gitignore, LICENSE, README.md
harnesses/demo/
  package.json
  harness.config.ts                 demo manifest: blocks `note` (visible) and `progress` (state)
  agent/AGENTS.md                   demo workflow instructions
  agent/seed/README.md              seed file copied into the user folder
packages/harness-sdk/
  src/index.ts                      Language, LocalizedText, Block, defineBlock, blockToolName,
                                    Permissions, Harness, defineHarness, LoadedHarness, loadHarness, resolveInHarness
  test/harness.test.ts
packages/engines/
  src/index.ts                      LegalStatus, TransportDef, EngineDef, ENGINES, availableEngines, getEngine
  test/engines.test.ts
packages/workspace/
  src/instructions.ts               managedSection, writeInstructions
  src/folder.ts                     prepareFolder
  src/history.ts                    History (init, save, last, restore, list)
  src/index.ts
  test/instructions.test.ts, test/folder.test.ts, test/history.test.ts
packages/blocks/
  src/bridge.ts                     openBridge, sendToBridge
  src/launch.ts                     Launcher, devLauncher, McpServerSpec, uiServerSpec
  src/ui-server.ts                  createUiServer
  src/ui-server-bin.ts              process entry for the `ui` MCP server
  src/index.ts
  test/bridge.test.ts, test/ui-server.test.ts
packages/fake-agent/
  src/script.ts                     ClaudeScript, AcpScript, writeScript, claude line helpers
  src/fake-claude.ts                stand-in for `claude -p --output-format stream-json`
  src/fake-acp.ts                   stand-in ACP agent
  src/index.ts                      fakeClaudeCommand, fakeAcpCommand + re-exports
packages/runtime/
  src/events.ts                     Event, ActivityKind, ErrorCode, EngineError, fail
  src/classify.ts                   classifyError
  src/transport.ts                  Session, TransportOptions, Transport
  src/claude-cli.ts                 allowedTools, claudeArgs, StreamJsonReader, ClaudeCliTransport
  src/acp.ts                        decidePermission, isUiTool, AcpTransport
  src/session-store.ts              readSession, writeSession
  src/runtime.ts                    createRuntime
  src/dev.ts                        `pnpm hh-dev` terminal runner
  src/index.ts
  test/classify.test.ts, test/claude-cli.test.ts, test/acp.test.ts, test/runtime.test.ts
docs/spikes/2026-10-10-transports.md
```

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `LICENSE`, `README.md`

- [ ] **Step 1: Create the root files**

`package.json`:
```json
{
  "name": "humanharness",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@12.10.1",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc -p tsconfig.json",
    "hh-dev": "tsx packages/runtime/src/dev.ts"
  },
  "devDependencies": {
    "@types/node": "^26.6.5",
    "tsx": "^4.23.15",
    "typescript": "^7.0.2",
    "vitest": "^5.0.3"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "harnesses/*"
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "types": ["node"]
  },
  "include": ["packages/*/src", "packages/*/test", "harnesses/*/*.ts"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

`.gitignore`:
```
node_modules/
dist/
tmp-spike/
.DS_Store
*.log
```

`LICENSE`: the standard MIT license text with `Copyright (c) 2026 Marco Zanger`.

`README.md`:
```markdown
# Human Harness

Open-source framework for building **harnesses**: installable desktop apps that put an interface and a defined workflow on top of an AI agent. Each user brings their own AI subscription through the provider's official CLI.

Status: early development. See `docs/superpowers/specs/` for the design and `docs/superpowers/plans/` for the roadmap.

## Development

    pnpm install
    pnpm test
    pnpm typecheck
```

- [ ] **Step 2: Install and run the empty suite**

Run: `pnpm install && pnpm test && pnpm typecheck`
Expected: install succeeds; vitest prints "No test files found, exiting with code 0"; typecheck passes (or reports "No inputs were found" — acceptable until Task 3 adds sources; if tsc exits non-zero only for that reason, continue).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo"
```

---

### Task 2: Transport spike (manual, throwaway)

Goal: confirm, with the real CLIs, the details Tasks 4, 11 and 12 depend on. Nothing from `tmp-spike/` is committed; the findings document is.

**Files:**
- Create (ignored): `tmp-spike/package.json`, `tmp-spike/note-mcp.mjs`, `tmp-spike/mcp.json`, `tmp-spike/acp-probe.mjs`
- Create: `docs/spikes/2026-10-10-transports.md`

Prerequisites: `claude` installed and logged in with a Pro/Max plan; `codex` installed and logged in with ChatGPT (`codex login`).

- [ ] **Step 1: Throwaway MCP server**

`tmp-spike/package.json`:
```json
{ "type": "module", "dependencies": { "@modelcontextprotocol/sdk": "1.32.1", "@agentclientprotocol/sdk": "1.8.0", "zod": "4.6.5" } }
```

`tmp-spike/note-mcp.mjs`:
```js
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { appendFileSync } from "node:fs";
import { z } from "zod";

const server = new McpServer({ name: "ui", version: "0.0.0" });
server.registerTool(
  "show_note",
  { description: "Shows a note to the user.", inputSchema: { title: z.string() } },
  async (args) => {
    appendFileSync(new URL("./calls.log", import.meta.url), JSON.stringify(args) + "\n");
    return { content: [{ type: "text", text: "Shown." }] };
  },
);
await server.connect(new StdioServerTransport());
```

Run: `cd tmp-spike && npm install && cd ..`
Then write `tmp-spike/mcp.json` with the absolute path of `note-mcp.mjs`:
```bash
printf '{"mcpServers":{"ui":{"type":"stdio","command":"node","args":["%s"]}}}' "$PWD/tmp-spike/note-mcp.mjs" > tmp-spike/mcp.json
```

- [ ] **Step 2: Claude through `claude -p`**

```bash
mkdir -p tmp-spike/work && cd tmp-spike/work
claude --version
claude -p "Call the show_note tool with title 'hello', then answer with the single word done." \
  --output-format stream-json --verbose --include-partial-messages \
  --setting-sources project --permission-mode acceptEdits \
  --allowedTools "Read,mcp__ui" --disallowedTools AskUserQuestion \
  --strict-mcp-config --mcp-config "$(cat ../mcp.json)" \
  --session-id "$(uuidgen | tr A-Z a-z)" > ../claude.jsonl
cd ../..
cat tmp-spike/calls.log
grep -o '"name":"mcp__ui__show_note"' tmp-spike/claude.jsonl | head -1
grep '"type":"result"' tmp-spike/claude.jsonl
```
Record: the `claude --version` output; whether `calls.log` has `{"title":"hello"}`; the exact tool name in `tool_use` blocks; whether the `result` line has `"subtype":"success"`; whether `--resume <id>` works on a second call with the same id.

- [ ] **Step 3: Codex through ACP**

`tmp-spike/acp-probe.mjs`:
```js
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as acp from "@agentclientprotocol/sdk";

const [cmd, ...args] = process.argv.slice(2);
const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] });
const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
const conn = acp
  .client({ name: "hh-spike" })
  .onRequest("session/request_permission", (ctx) => {
    console.log("PERMISSION", JSON.stringify(ctx.params));
    const allow = ctx.params.options.find((o) => o.kind === "allow_once") ?? ctx.params.options[0];
    return { outcome: { outcome: "selected", optionId: allow.optionId } };
  })
  .onNotification("session/update", (ctx) => console.log("UPDATE", JSON.stringify(ctx.params.update)))
  .connect(stream);

const init = await conn.agent.request("initialize", {
  protocolVersion: acp.PROTOCOL_VERSION,
  clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
});
console.log("INIT", JSON.stringify(init));
const cwd = mkdtempSync(join(tmpdir(), "hh-spike-"));
const session = await conn.agent.request("session/new", {
  cwd,
  mcpServers: [{ name: "ui", command: "node", args: [new URL("./note-mcp.mjs", import.meta.url).pathname], env: [] }],
});
console.log("SESSION", JSON.stringify(session));
const res = await conn.agent.request("session/prompt", {
  sessionId: session.sessionId,
  prompt: [{ type: "text", text: "Call the show_note tool with title 'hello', then create a file named a.txt containing hi, then answer done." }],
});
console.log("STOP", JSON.stringify(res));
child.kill();
process.exit(0);
```

Run: `node tmp-spike/acp-probe.mjs npx -y @zed-industries/codex-acp > tmp-spike/codex.log 2>&1; cat tmp-spike/codex.log; cat tmp-spike/calls.log`

Record: the `INIT` response (`agentCapabilities.loadSession`, `authMethods`); whether the `codex` CLI must be installed separately and whether it reuses `codex login`; the `title` and `kind` of the `tool_call` for `show_note`; the `kind` and `locations` in the `PERMISSION` request for the file write (and whether one arrives at all); the `stopReason`; the `@zed-industries/codex-acp` version and its bin name (`npm view @zed-industries/codex-acp bin`); `codex --version`.

- [ ] **Step 4: Write the findings**

Create `docs/spikes/2026-10-10-transports.md` with this structure and the recorded values:
```markdown
# Spike: transports (2026-10-10)

## Claude (`claude -p`)
- Version tested: …
- MCP tool name in stream-json: …
- `--mcp-config` inline JSON + `--strict-mcp-config`: works / fails (…)
- `--resume` on second call: works / fails
- Result line on success: …

## Codex (ACP via @zed-industries/codex-acp)
- codex-acp version / bin: …
- codex CLI version: …
- Auth: reuses `codex login` yes/no; authMethods: …
- loadSession supported: yes/no
- tool_call for MCP tool: title "…", kind "…"
- File write: permission requested yes/no; kind "…"; locations …
- stopReason: …

## Decisions for plan 1
- `minVersion` for claude: …   (Task 4)
- `minVersion` for codex: …    (Task 4)
- codex transport command: …   (Task 4)
- `isUiTool` matches: …        (Task 12)
- ACP kind "other" policy: …   (Task 12)
```

Fill "Decisions for plan 1" with: the minimum versions = the versions tested; the codex command that worked; whether the tool_call title contains `show_note` (if it does, keep the regex in Task 12; if it doesn't, record what identifies it); whether MCP tool calls arrive as permission requests with kind `other`.

- [ ] **Step 5: Commit the findings only**

```bash
git add docs/spikes/2026-10-10-transports.md
git commit -m "docs: transport spike findings"
```

**Decision point:** if Claude ignores `--mcp-config`/`--strict-mcp-config`, or Codex cannot load the MCP server through `session/new`, stop and report to Marco before Task 7 — the block design (MCP tools) depends on it.

---

### Task 3: harness-sdk and the demo harness

**Files:**
- Create: `packages/harness-sdk/package.json`, `packages/harness-sdk/src/index.ts`, `packages/harness-sdk/test/harness.test.ts`
- Create: `harnesses/demo/package.json`, `harnesses/demo/harness.config.ts`, `harnesses/demo/agent/AGENTS.md`, `harnesses/demo/agent/seed/README.md`

- [ ] **Step 1: Package manifests**

`packages/harness-sdk/package.json`:
```json
{
  "name": "@humanharness/harness-sdk",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "zod": "^4.6.5" }
}
```

`harnesses/demo/package.json`:
```json
{
  "name": "@humanharness/harness-demo",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@humanharness/harness-sdk": "workspace:*",
    "zod": "^4.6.5"
  }
}
```

Run: `pnpm install`

- [ ] **Step 2: Demo harness files**

`harnesses/demo/harness.config.ts`:
```ts
import { z } from "zod";
import { defineBlock, defineHarness } from "@humanharness/harness-sdk";

const note = defineBlock({
  description: "Shows a note with a title and a body to the user.",
  visible: true,
  schema: z.object({ title: z.string().min(1), body: z.string() }),
  example: { title: "Example", body: "Text of the note." },
});

const progress = defineBlock({
  description: "Updates the progress of the session, from 0 to 100.",
  visible: false,
  schema: z.object({ percent: z.number().min(0).max(100) }),
  example: { percent: 50 },
});

export default defineHarness({
  id: "demo",
  name: { es: "Demo", en: "Demo" },
  core: "^0.1.0",
  languages: ["es", "en"],
  engines: ["claude", "codex"],
  folder: { suggested: "Documents/Human Harness Demo", seed: "./agent/seed" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "folder", exec: false, web: false },
  blocks: { note, progress },
  author: "Marco Zanger",
});
```

`harnesses/demo/agent/AGENTS.md`:
```markdown
# Demo

You are a test assistant for Human Harness.

- When the person asks for a note, call the `show_note` tool and also save it as `notes/<title>.md`.
- After every answer, call `update_progress` with how far along the conversation is (0 to 100).
```

`harnesses/demo/agent/seed/README.md`:
```markdown
This folder is used by the Human Harness demo app.
```

- [ ] **Step 3: Write the failing tests**

`packages/harness-sdk/test/harness.test.ts`:
```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { blockToolName, defineBlock, defineHarness, loadHarness, resolveInHarness } from "../src";

const DEMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../harnesses/demo/harness.config.ts");

const block = defineBlock({
  description: "A note.",
  visible: true,
  schema: z.object({ title: z.string() }),
  example: { title: "x" },
});

const base = {
  id: "test",
  name: { es: "Prueba", en: "Test" },
  core: "^0.1.0",
  languages: ["es", "en"] as const,
  engines: ["claude"],
  folder: { suggested: "Documents/Test" },
  instructions: "./AGENTS.md",
  permissions: { edit: "folder" as const, exec: false, web: false },
  blocks: { note: block },
  author: "Someone",
};

describe("defineBlock", () => {
  it("rejects an example that does not match the schema", () => {
    expect(() =>
      defineBlock({ description: "x", visible: true, schema: z.object({ n: z.number() }), example: { n: "no" } as never }),
    ).toThrow(/example/);
  });
});

describe("blockToolName", () => {
  it("uses show_ for visible blocks and update_ for state blocks", () => {
    expect(blockToolName("note", block)).toBe("show_note");
    expect(blockToolName("progress", { ...block, visible: false })).toBe("update_progress");
  });
});

describe("defineHarness", () => {
  it("fills defaults", () => {
    const h = defineHarness({ ...base, languages: [...base.languages] });
    expect(h.mcp).toEqual([]);
    expect(h.blocks.note).toBe(block);
  });

  it("rejects invalid block names", () => {
    expect(() => defineHarness({ ...base, languages: [...base.languages], blocks: { "Bad-Name": block } })).toThrow();
  });

  it("rejects an unknown language", () => {
    expect(() => defineHarness({ ...base, languages: ["fr" as never] })).toThrow();
  });
});

describe("loadHarness", () => {
  it("loads a manifest and records its root", async () => {
    const h = await loadHarness(DEMO);
    expect(h.id).toBe("demo");
    expect(h.root).toBe(path.dirname(DEMO));
    expect(h.configPath).toBe(DEMO);
    expect(resolveInHarness(h, h.instructions)).toBe(path.join(path.dirname(DEMO), "agent/AGENTS.md"));
    expect(Object.keys(h.blocks)).toEqual(["note", "progress"]);
  });
});
```

- [ ] **Step 4: Run to verify they fail**

Run: `pnpm vitest run packages/harness-sdk`
Expected: FAIL — cannot resolve `../src`.

- [ ] **Step 5: Implement**

`packages/harness-sdk/src/index.ts`:
```ts
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

export const LANGUAGES = ["es", "en"] as const;
export type Language = (typeof LANGUAGES)[number];
export type LocalizedText = Record<Language, string>;

/** A piece of UI the agent can show (visible) or update (state-only) through an MCP tool. */
export interface Block<S extends z.ZodObject = z.ZodObject> {
  description: string;
  visible: boolean;
  schema: S;
  example: z.infer<S>;
}

export function defineBlock<S extends z.ZodObject>(block: Block<S>): Block<S> {
  const result = block.schema.safeParse(block.example);
  if (!result.success) throw new Error(`The block example does not match its schema: ${result.error.message}`);
  return block;
}

/** Name of the MCP tool the agent calls for a block. */
export function blockToolName(name: string, block: Pick<Block, "visible">): string {
  return `${block.visible ? "show" : "update"}_${name}`;
}

const localizedText = z.object({ es: z.string().min(1), en: z.string().min(1) });
const blockSchema = z.custom<Block>(
  (b) => typeof b === "object" && b !== null && "schema" in b && "description" in b,
  { message: "Expected a block created with defineBlock()" },
);

const manifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: localizedText,
  core: z.string().min(1),
  languages: z.array(z.enum(LANGUAGES)).min(1),
  engines: z.array(z.string().min(1)).min(1),
  folder: z.object({ suggested: z.string().min(1), seed: z.string().optional() }),
  instructions: z.string().min(1),
  permissions: z.object({ edit: z.enum(["folder", "none"]), exec: z.boolean(), web: z.boolean() }),
  blocks: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), blockSchema),
  mcp: z.array(z.string()).default([]),
  ui: z.string().optional(),
  locales: z.string().optional(),
  author: z.string().min(1),
  repo: z.url().optional(),
  donate: z.url().optional(),
});

export type Harness = z.output<typeof manifestSchema>;
export type HarnessInput = z.input<typeof manifestSchema>;
export type Permissions = Harness["permissions"];

export function defineHarness(config: HarnessInput): Harness {
  return manifestSchema.parse(config);
}

export interface LoadedHarness extends Harness {
  /** Absolute folder that contains the manifest. */
  root: string;
  /** Absolute path of the manifest file. */
  configPath: string;
}

export async function loadHarness(configPath: string): Promise<LoadedHarness> {
  const absolute = path.resolve(configPath);
  const mod = (await import(pathToFileURL(absolute).href)) as { default: unknown };
  const harness = manifestSchema.parse(mod.default);
  return { ...harness, root: path.dirname(absolute), configPath: absolute };
}

export function resolveInHarness(harness: LoadedHarness, relative: string): string {
  return path.resolve(harness.root, relative);
}
```

- [ ] **Step 6: Run to verify they pass**

Run: `pnpm vitest run packages/harness-sdk && pnpm typecheck`
Expected: PASS (6 tests); typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(harness-sdk): manifest, blocks and loader with demo harness"
```

---

### Task 4: engines registry

**Files:**
- Create: `packages/engines/package.json`, `packages/engines/src/index.ts`, `packages/engines/test/engines.test.ts`

Use the values from `docs/spikes/2026-10-10-transports.md` for `minVersion` and the codex `command`. The values below are the expected ones; replace them if the spike recorded different ones.

- [ ] **Step 1: Package manifest**

`packages/engines/package.json`:
```json
{
  "name": "@humanharness/engines",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@humanharness/harness-sdk": "workspace:*" }
}
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing tests**

`packages/engines/test/engines.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ENGINES, availableEngines, getEngine } from "../src";

describe("ENGINES", () => {
  it("has unique ids and a dated source for every status", () => {
    const ids = ENGINES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of ENGINES) expect(e.statusSource).toMatch(/^https:\/\/\S+ \(\d{4}-\d{2}-\d{2}\)$/);
  });

  it("allows only Claude and Codex in v1", () => {
    expect(ENGINES.filter((e) => e.status === "allowed").map((e) => e.id).sort()).toEqual(["claude", "codex"]);
  });

  it("runs Claude through the official binary, never through ACP", () => {
    expect(getEngine("claude").transport).toEqual({ kind: "claude-cli", binary: "claude" });
  });
});

describe("availableEngines", () => {
  it("offers only allowed engines in distribution builds", () => {
    expect(availableEngines(["claude", "codex", "kimi", "gemini"], "distribution").map((e) => e.id)).toEqual(["claude", "codex"]);
  });

  it("adds pending engines in development, never excluded ones", () => {
    expect(availableEngines(["claude", "kimi", "gemini"], "development").map((e) => e.id)).toEqual(["claude", "kimi"]);
  });

  it("ignores unknown ids", () => {
    expect(availableEngines(["nope", "codex"], "distribution").map((e) => e.id)).toEqual(["codex"]);
  });
});

describe("getEngine", () => {
  it("throws for unknown ids", () => {
    expect(() => getEngine("nope")).toThrow(/Unknown engine/);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run packages/engines`
Expected: FAIL — cannot resolve `../src`.

- [ ] **Step 4: Implement**

`packages/engines/src/index.ts`:
```ts
import type { LocalizedText } from "@humanharness/harness-sdk";

export type LegalStatus = "allowed" | "pending" | "excluded";

export type TransportDef =
  | { kind: "claude-cli"; binary: string }
  | { kind: "acp"; command: string[] };

export interface EngineDef {
  id: string;
  name: string;
  status: LegalStatus;
  /** Where the status comes from: "<url> (<yyyy-mm-dd>)". */
  statusSource: string;
  requires: LocalizedText;
  dataLocation: LocalizedText;
  trainsOnData: LocalizedText;
  termsUrl: string;
  privacyUrl: string;
  detect: { binary: string; versionArgs: string[]; minVersion: string };
  transport: TransportDef;
  /** Extra file some engines need to pick up AGENTS.md. */
  instructionsFile?: { path: string; content: string };
}

export const ENGINES: readonly EngineDef[] = [
  {
    id: "claude",
    name: "Claude",
    status: "allowed",
    statusSource: "https://code.claude.com/docs/en/legal-and-compliance (2026-10-10)",
    requires: { es: "Plan Claude Pro o Max", en: "Claude Pro or Max plan" },
    dataLocation: { es: "Anthropic, EE. UU.", en: "Anthropic, USA" },
    trainsOnData: {
      es: "Según tu configuración de privacidad en claude.ai",
      en: "Depends on your privacy settings in claude.ai",
    },
    termsUrl: "https://www.anthropic.com/legal/consumer-terms",
    privacyUrl: "https://www.anthropic.com/legal/privacy",
    detect: { binary: "claude", versionArgs: ["--version"], minVersion: "2.0.0" },
    transport: { kind: "claude-cli", binary: "claude" },
    instructionsFile: { path: "CLAUDE.md", content: "@AGENTS.md\n" },
  },
  {
    id: "codex",
    name: "Codex",
    status: "allowed",
    statusSource: "https://developers.openai.com/siwc/token-sharing-open-source (2026-10-10)",
    requires: { es: "Plan de ChatGPT (Plus, Pro o superior)", en: "ChatGPT plan (Plus, Pro or higher)" },
    dataLocation: { es: "OpenAI, EE. UU.", en: "OpenAI, USA" },
    trainsOnData: {
      es: "Según tu configuración de controles de datos en ChatGPT",
      en: "Depends on your data controls in ChatGPT",
    },
    termsUrl: "https://openai.com/policies/terms-of-use/",
    privacyUrl: "https://openai.com/policies/privacy-policy/",
    detect: { binary: "codex", versionArgs: ["--version"], minVersion: "0.50.0" },
    transport: { kind: "acp", command: ["npx", "-y", "@zed-industries/codex-acp"] },
  },
  {
    id: "kimi",
    name: "Kimi",
    status: "pending",
    statusSource: "https://www.kimi.com/en/help/kimi-code/membership-guide (2026-10-10)",
    requires: { es: "Membresía Kimi Code", en: "Kimi Code membership" },
    dataLocation: { es: "Moonshot AI, China", en: "Moonshot AI, China" },
    trainsOnData: { es: "Sí, por defecto (opt-out por solicitud)", en: "Yes, by default (opt-out on request)" },
    termsUrl: "https://www.kimi.com/user/agreement/en/modelUse?version=v2",
    privacyUrl: "https://www.kimi.com/es-419/help/others/data-usage",
    detect: { binary: "kimi", versionArgs: ["--version"], minVersion: "0.0.0" },
    transport: { kind: "acp", command: ["kimi", "acp"] },
  },
  {
    id: "gemini",
    name: "Gemini",
    status: "excluded",
    statusSource: "https://github.com/google-gemini/gemini-cli/discussions/27274 (2026-10-10)",
    requires: { es: "—", en: "—" },
    dataLocation: { es: "Google, EE. UU.", en: "Google, USA" },
    trainsOnData: { es: "—", en: "—" },
    termsUrl: "https://geminicli.com/docs/resources/tos-privacy/",
    privacyUrl: "https://policies.google.com/privacy",
    detect: { binary: "gemini", versionArgs: ["--version"], minVersion: "0.0.0" },
    transport: { kind: "acp", command: ["gemini", "--experimental-acp"] },
  },
  {
    id: "qwen",
    name: "Qwen",
    status: "excluded",
    statusSource: "https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/ (2026-10-10)",
    requires: { es: "—", en: "—" },
    dataLocation: { es: "Alibaba Cloud", en: "Alibaba Cloud" },
    trainsOnData: { es: "—", en: "—" },
    termsUrl: "https://qwenlm.github.io/qwen-code-docs/en/users/support/tos-privacy/",
    privacyUrl: "https://qwenlm.github.io/qwen-code-docs/en/users/support/tos-privacy/",
    detect: { binary: "qwen", versionArgs: ["--version"], minVersion: "0.0.0" },
    transport: { kind: "acp", command: ["qwen", "--acp"] },
  },
];

export type Mode = "distribution" | "development";

export function getEngine(id: string): EngineDef {
  const engine = ENGINES.find((e) => e.id === id);
  if (!engine) throw new Error(`Unknown engine: ${id}`);
  return engine;
}

/** Engines a harness may offer: the ones it was tested with, filtered by legal status. */
export function availableEngines(harnessEngineIds: string[], mode: Mode): EngineDef[] {
  const accepted: LegalStatus[] = mode === "distribution" ? ["allowed"] : ["allowed", "pending"];
  return harnessEngineIds
    .map((id) => ENGINES.find((e) => e.id === id))
    .filter((e): e is EngineDef => e !== undefined && accepted.includes(e.status));
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm vitest run packages/engines && pnpm typecheck`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(engines): engine registry with legal status"
```

---

### Task 5: workspace — instructions and folder

**Files:**
- Create: `packages/workspace/package.json`, `packages/workspace/src/instructions.ts`, `packages/workspace/src/folder.ts`, `packages/workspace/src/index.ts`
- Test: `packages/workspace/test/instructions.test.ts`, `packages/workspace/test/folder.test.ts`

- [ ] **Step 1: Package manifest**

`packages/workspace/package.json`:
```json
{
  "name": "@humanharness/workspace",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@humanharness/engines": "workspace:*",
    "@humanharness/harness-sdk": "workspace:*",
    "isomorphic-git": "^1.43.3",
    "zod": "^4.6.5"
  }
}
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing tests**

`packages/workspace/test/instructions.test.ts`:
```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineBlock } from "@humanharness/harness-sdk";
import { getEngine } from "@humanharness/engines";
import { MANAGED_END, MANAGED_START, managedSection, writeInstructions } from "../src";

const blocks = {
  note: defineBlock({
    description: "Shows a note.",
    visible: true,
    schema: z.object({ title: z.string() }),
    example: { title: "Hi" },
  }),
  progress: defineBlock({
    description: "Updates progress.",
    visible: false,
    schema: z.object({ percent: z.number() }),
    example: { percent: 10 },
  }),
};

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));

describe("managedSection", () => {
  it("is delimited and states the answer language", () => {
    const es = managedSection({ language: "es", blocks });
    expect(es.startsWith(MANAGED_START)).toBe(true);
    expect(es.trimEnd().endsWith(MANAGED_END)).toBe(true);
    expect(es).toContain("Respondé siempre en español.");
    expect(managedSection({ language: "en", blocks })).toContain("Always answer in English.");
  });

  it("documents every block tool with its example and schema", () => {
    const s = managedSection({ language: "en", blocks });
    expect(s).toContain("`show_note`");
    expect(s).toContain("`update_progress`");
    expect(s).toContain('{"title":"Hi"}');
    expect(s).toContain('"percent"');
  });
});

describe("writeInstructions", () => {
  it("writes AGENTS.md plus the engine's own file", async () => {
    const folder = tmp();
    const written = await writeInstructions({
      folder,
      base: "# Flow\n\nDo things.\n",
      language: "es",
      blocks,
      engine: getEngine("claude"),
    });
    expect(written.sort()).toEqual(["AGENTS.md", "CLAUDE.md"]);
    const agents = fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8");
    expect(agents.startsWith("# Flow\n\nDo things.\n\n" + MANAGED_START)).toBe(true);
    expect(fs.readFileSync(path.join(folder, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
  });

  it("writes only AGENTS.md for engines that read it directly", async () => {
    const folder = tmp();
    const written = await writeInstructions({ folder, base: "x", language: "en", blocks, engine: getEngine("codex") });
    expect(written).toEqual(["AGENTS.md"]);
    expect(fs.existsSync(path.join(folder, "CLAUDE.md"))).toBe(false);
  });

  it("is idempotent", async () => {
    const folder = tmp();
    const opts = { folder, base: "x", language: "en" as const, blocks, engine: getEngine("codex") };
    await writeInstructions(opts);
    const first = fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8");
    await writeInstructions(opts);
    expect(fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8")).toBe(first);
  });
});
```

`packages/workspace/test/folder.test.ts`:
```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prepareFolder } from "../src";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));

function seedDir(): string {
  const seed = tmp();
  fs.mkdirSync(path.join(seed, "notes"));
  fs.writeFileSync(path.join(seed, "README.md"), "seed");
  fs.writeFileSync(path.join(seed, "notes", "first.md"), "first");
  return seed;
}

describe("prepareFolder", () => {
  it("creates the folder and copies the seed the first time", async () => {
    const folder = path.join(tmp(), "Work");
    expect(await prepareFolder(folder, seedDir())).toBe(true);
    expect(fs.readFileSync(path.join(folder, "notes", "first.md"), "utf8")).toBe("first");
  });

  it("does not copy the seed into a folder that already has content", async () => {
    const folder = tmp();
    fs.writeFileSync(path.join(folder, "mine.md"), "mine");
    expect(await prepareFolder(folder, seedDir())).toBe(false);
    expect(fs.existsSync(path.join(folder, "README.md"))).toBe(false);
  });

  it("treats a folder holding only .harness as empty", async () => {
    const folder = tmp();
    fs.mkdirSync(path.join(folder, ".harness"));
    expect(await prepareFolder(folder, seedDir())).toBe(true);
  });

  it("works without a seed", async () => {
    const folder = path.join(tmp(), "Empty");
    expect(await prepareFolder(folder)).toBe(false);
    expect(fs.existsSync(folder)).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run packages/workspace`
Expected: FAIL — cannot resolve `../src`.

- [ ] **Step 4: Implement**

`packages/workspace/src/instructions.ts`:
```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { EngineDef } from "@humanharness/engines";
import { type Block, type Language, blockToolName } from "@humanharness/harness-sdk";

export const MANAGED_START = "<!-- humanharness:start -->";
export const MANAGED_END = "<!-- humanharness:end -->";

const TEXT: Record<Language, { title: string; rules: string[]; tools: string; example: string; schema: string }> = {
  es: {
    title: "## Entorno (lo genera Human Harness; no editar)",
    rules: [
      "Respondé siempre en español.",
      "Estás dentro de una app de escritorio: la persona te habla desde una interfaz, no desde una terminal. No le muestres comandos ni rutas de archivos salvo que te las pida.",
      "No uses preguntas interactivas propias de tu CLI: preguntá con texto o con las herramientas de interfaz de abajo.",
      "Trabajá solo dentro de esta carpeta. Mensajes cortos y claros.",
    ],
    tools: "### Herramientas de interfaz",
    example: "Ejemplo",
    schema: "Schema",
  },
  en: {
    title: "## Environment (generated by Human Harness; do not edit)",
    rules: [
      "Always answer in English.",
      "You are running inside a desktop app: the person talks to you from an interface, not a terminal. Don't show commands or file paths unless asked.",
      "Don't use your CLI's own interactive questions: ask in plain text or with the interface tools below.",
      "Work only inside this folder. Keep messages short and clear.",
    ],
    tools: "### Interface tools",
    example: "Example",
    schema: "Schema",
  },
};

export function managedSection(opts: { language: Language; blocks: Record<string, Block> }): string {
  const t = TEXT[opts.language];
  const lines = [MANAGED_START, t.title, "", ...t.rules.map((r) => `- ${r}`)];
  const entries = Object.entries(opts.blocks);
  if (entries.length > 0) {
    lines.push("", t.tools, "");
    for (const [name, block] of entries) {
      lines.push(
        `- \`${blockToolName(name, block)}\`: ${block.description}`,
        `  ${t.example}: \`${JSON.stringify(block.example)}\``,
        `  ${t.schema}: \`${JSON.stringify(z.toJSONSchema(block.schema))}\``,
      );
    }
  }
  lines.push(MANAGED_END, "");
  return lines.join("\n");
}

/** Writes AGENTS.md (harness base + managed section) and the engine's own file. Returns the relative paths written. */
export async function writeInstructions(opts: {
  folder: string;
  base: string;
  language: Language;
  blocks: Record<string, Block>;
  engine: EngineDef;
}): Promise<string[]> {
  await fs.mkdir(opts.folder, { recursive: true });
  const agents = `${opts.base.trimEnd()}\n\n${managedSection({ language: opts.language, blocks: opts.blocks })}`;
  await fs.writeFile(path.join(opts.folder, "AGENTS.md"), agents);
  const written = ["AGENTS.md"];
  const extra = opts.engine.instructionsFile;
  if (extra) {
    await fs.writeFile(path.join(opts.folder, extra.path), extra.content);
    written.push(extra.path);
  }
  return written;
}
```

`packages/workspace/src/folder.ts`:
```ts
import { promises as fs } from "node:fs";

/** Creates the user folder. Copies the seed only if the folder has no content yet. Returns whether the seed was copied. */
export async function prepareFolder(folder: string, seed?: string): Promise<boolean> {
  await fs.mkdir(folder, { recursive: true });
  const entries = (await fs.readdir(folder)).filter((e) => e !== ".harness" && e !== ".DS_Store");
  if (!seed || entries.length > 0) return false;
  await fs.cp(seed, folder, { recursive: true });
  return true;
}
```

`packages/workspace/src/index.ts`:
```ts
export * from "./instructions";
export * from "./folder";
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm vitest run packages/workspace && pnpm typecheck`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(workspace): managed AGENTS.md and folder seeding"
```

---

### Task 6: workspace — history

**Files:**
- Create: `packages/workspace/src/history.ts`
- Modify: `packages/workspace/src/index.ts`
- Test: `packages/workspace/test/history.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/workspace/test/history.test.ts`:
```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { History } from "../src";

let folder: string;
let gitdir: string;
let history: History;

const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
  fs.writeFileSync(path.join(folder, rel), content);
};
const read = (rel: string) => fs.readFileSync(path.join(folder, rel), "utf8");

beforeEach(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
  folder = path.join(base, "work");
  gitdir = path.join(base, "history.git");
  fs.mkdirSync(folder);
  history = new History(folder, gitdir, [".harness/", "AGENTS.md"]);
  await history.init();
});

describe("History", () => {
  it("keeps the git data outside the user folder", async () => {
    write("a.md", "1");
    await history.save("first");
    expect(fs.existsSync(path.join(folder, ".git"))).toBe(false);
    expect(fs.existsSync(path.join(gitdir, "HEAD"))).toBe(true);
  });

  it("commits changes and skips empty saves", async () => {
    write("a.md", "1");
    const sha = await history.save("first");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(await history.save("nothing")).toBeNull();
    expect(await history.last()).toBe(sha);
  });

  it("commits an empty folder once so there is always a base", async () => {
    expect(await history.save("start")).toMatch(/^[0-9a-f]{40}$/);
    expect(await history.save("again")).toBeNull();
  });

  it("restores modified, deleted and new files", async () => {
    write("a.md", "1");
    write("dir/b.md", "b");
    const before = (await history.save("before"))!;
    write("a.md", "2");
    fs.rmSync(path.join(folder, "dir/b.md"));
    write("c.md", "new");
    await history.save("agent turn");

    await history.restore(before, "undo");

    expect(read("a.md")).toBe("1");
    expect(read("dir/b.md")).toBe("b");
    expect(fs.existsSync(path.join(folder, "c.md"))).toBe(false);
  });

  it("restores uncommitted changes too", async () => {
    write("a.md", "1");
    const before = (await history.save("before"))!;
    write("a.md", "half-written");
    await history.restore(before, "undo");
    expect(read("a.md")).toBe("1");
  });

  it("never tracks ignored paths", async () => {
    write(".harness/session.json", "{}");
    write("AGENTS.md", "generated");
    write("a.md", "1");
    const before = (await history.save("before"))!;
    write(".harness/session.json", '{"changed":true}');
    await history.restore(before, "undo");
    expect(read(".harness/session.json")).toBe('{"changed":true}');
    expect(read("AGENTS.md")).toBe("generated");
  });

  it("lists entries newest first", async () => {
    write("a.md", "1");
    await history.save("one");
    write("a.md", "2");
    await history.save("two");
    const entries = await history.list();
    expect(entries.map((e) => e.message)).toEqual(["two", "one"]);
    expect(entries[0].date).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run packages/workspace/test/history.test.ts`
Expected: FAIL — `History` is not exported.

- [ ] **Step 3: Implement**

`packages/workspace/src/history.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import git from "isomorphic-git";

const AUTHOR = { name: "Human Harness", email: "history@humanharness.local" };

export interface HistoryEntry {
  sha: string;
  message: string;
  date: Date;
}

/**
 * Local, invisible version history of the user folder. The git data lives in `gitdir`
 * (outside the folder) so the user never sees it and cloud sync never touches it.
 */
export class History {
  constructor(
    private readonly folder: string,
    private readonly gitdir: string,
    private readonly ignore: string[] = [".harness/"],
  ) {}

  private repo() {
    return { fs, dir: this.folder, gitdir: this.gitdir };
  }

  private tracked = (file: string): boolean =>
    !this.ignore.some((i) => (i.endsWith("/") ? file.startsWith(i) : file === i)) && !file.endsWith(".DS_Store");

  async init(): Promise<void> {
    await fs.promises.mkdir(this.gitdir, { recursive: true });
    if (!fs.existsSync(path.join(this.gitdir, "HEAD"))) {
      await git.init({ ...this.repo(), defaultBranch: "main" });
    }
  }

  async last(): Promise<string | null> {
    try {
      return await git.resolveRef({ fs, gitdir: this.gitdir, ref: "HEAD" });
    } catch {
      return null;
    }
  }

  /** Commits the current state. Returns the new sha, or null when nothing changed. */
  async save(message: string): Promise<string | null> {
    const matrix = await git.statusMatrix({ ...this.repo(), filter: this.tracked });
    let changed = false;
    for (const [file, head, workdir, stage] of matrix) {
      if (head === 1 && workdir === 1 && stage === 1) continue;
      changed = true;
      if (workdir === 0) await git.remove({ ...this.repo(), filepath: file });
      else await git.add({ ...this.repo(), filepath: file });
    }
    if (!changed && (await this.last()) !== null) return null;
    return git.commit({ ...this.repo(), message, author: AUTHOR });
  }

  /** Makes the folder look exactly like `sha` (tracked files only) and records that as a new commit. */
  async restore(sha: string, message: string): Promise<string | null> {
    const target = new Set(await git.listFiles({ ...this.repo(), ref: sha }));
    const current = await git.statusMatrix({ ...this.repo(), filter: this.tracked });
    for (const [file] of current) {
      if (!target.has(file)) await fs.promises.rm(path.join(this.folder, file), { force: true });
    }
    for (const file of target) {
      const { blob } = await git.readBlob({ ...this.repo(), oid: sha, filepath: file });
      const absolute = path.join(this.folder, file);
      await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
      await fs.promises.writeFile(absolute, blob);
    }
    return this.save(message);
  }

  async list(depth = 50): Promise<HistoryEntry[]> {
    if ((await this.last()) === null) return [];
    const log = await git.log({ ...this.repo(), depth });
    return log.map((e) => ({
      sha: e.oid,
      message: e.commit.message.trim(),
      date: new Date(e.commit.author.timestamp * 1000),
    }));
  }
}
```

Append to `packages/workspace/src/index.ts`:
```ts
export * from "./history";
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run packages/workspace && pnpm typecheck`
Expected: PASS (16 tests in workspace).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(workspace): hidden local history with restore"
```

---

### Task 7: blocks — bridge, launcher and `ui` MCP server

**Files:**
- Create: `packages/blocks/package.json`, `packages/blocks/src/bridge.ts`, `packages/blocks/src/launch.ts`, `packages/blocks/src/ui-server.ts`, `packages/blocks/src/ui-server-bin.ts`, `packages/blocks/src/index.ts`
- Test: `packages/blocks/test/bridge.test.ts`, `packages/blocks/test/ui-server.test.ts`

- [ ] **Step 1: Package manifest**

`packages/blocks/package.json`:
```json
{
  "name": "@humanharness/blocks",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@humanharness/harness-sdk": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.32.1",
    "tsx": "^4.23.15",
    "zod": "^4.6.5"
  }
}
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing tests**

`packages/blocks/test/bridge.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { type BlockMessage, openBridge, sendToBridge } from "../src";

describe("bridge", () => {
  it("delivers block messages in order", async () => {
    const received: BlockMessage[] = [];
    const bridge = await openBridge((m) => received.push(m));
    await sendToBridge(bridge.path, { name: "note", data: { title: "a" } });
    await sendToBridge(bridge.path, { name: "progress", data: { percent: 5 } });
    await bridge.close();
    expect(received).toEqual([
      { name: "note", data: { title: "a" } },
      { name: "progress", data: { percent: 5 } },
    ]);
  });

  it("rejects when nobody is listening", async () => {
    const bridge = await openBridge(() => {});
    await bridge.close();
    await expect(sendToBridge(bridge.path, { name: "note", data: {} })).rejects.toThrow();
  });
});
```

`packages/blocks/test/ui-server.test.ts`:
```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { type BlockMessage, type Bridge, devLauncher, openBridge, uiServerSpec } from "../src";

const DEMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../harnesses/demo/harness.config.ts");

let bridge: Bridge | undefined;
let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  await bridge?.close();
});

async function connect(received: BlockMessage[]) {
  bridge = await openBridge((m) => received.push(m));
  const spec = uiServerSpec({ harnessConfig: DEMO, bridge: bridge.path, launcher: devLauncher() });
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: spec.command,
      args: spec.args,
      env: { ...(process.env as Record<string, string>), ...spec.env },
    }),
  );
  return client;
}

describe("ui MCP server", () => {
  it("exposes one tool per block", async () => {
    const c = await connect([]);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["show_note", "update_progress"]);
    expect(tools.find((t) => t.name === "show_note")?.description).toContain("note");
  });

  it("forwards valid calls through the bridge", async () => {
    const received: BlockMessage[] = [];
    const c = await connect(received);
    const result = await c.callTool({ name: "show_note", arguments: { title: "Hello", body: "World" } });
    expect(result.isError).toBeFalsy();
    expect(received).toEqual([{ name: "note", data: { title: "Hello", body: "World" } }]);
  });

  it("rejects calls that break the schema and forwards nothing", async () => {
    const received: BlockMessage[] = [];
    const c = await connect(received);
    const result = await c
      .callTool({ name: "update_progress", arguments: { percent: 500 } })
      .catch(() => ({ isError: true }));
    expect(result.isError).toBe(true);
    expect(received).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run packages/blocks`
Expected: FAIL — cannot resolve `../src`.

- [ ] **Step 4: Implement**

`packages/blocks/src/bridge.ts`:
```ts
import { randomUUID } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export interface BlockMessage {
  name: string;
  data: unknown;
}

export interface Bridge {
  /** Unix socket path (or Windows named pipe) the `ui` MCP server writes to. */
  path: string;
  close(): Promise<void>;
}

function newBridgePath(): string {
  const id = randomUUID().slice(0, 8);
  return process.platform === "win32" ? `\\\\.\\pipe\\hh-${id}` : path.join(os.tmpdir(), `hh-${id}.sock`);
}

/** Local channel from the `ui` MCP server (a child of the agent) back to the runtime. Newline-delimited JSON. */
export async function openBridge(onMessage: (message: BlockMessage) => void): Promise<Bridge> {
  const bridgePath = newBridgePath();
  const server = net.createServer((socket) => {
    let rest = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      rest += chunk;
      let i: number;
      while ((i = rest.indexOf("\n")) >= 0) {
        const line = rest.slice(0, i);
        rest = rest.slice(i + 1);
        try {
          onMessage(JSON.parse(line) as BlockMessage);
          socket.write("ok\n");
        } catch {
          socket.write("error\n");
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(bridgePath, () => resolve());
  });
  return {
    path: bridgePath,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export function sendToBridge(bridgePath: string, message: BlockMessage, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(bridgePath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Bridge timeout"));
    }, timeoutMs);
    let answer = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(JSON.stringify(message) + "\n"));
    socket.on("data", (chunk: string) => {
      answer += chunk;
      if (!answer.includes("\n")) return;
      clearTimeout(timer);
      socket.end();
      if (answer.startsWith("ok")) resolve();
      else reject(new Error("Bridge rejected the message"));
    });
    socket.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}
```

`packages/blocks/src/launch.ts`:
```ts
import { fileURLToPath } from "node:url";

/** How to start a Node process that runs TypeScript (tsx in development; Electron's Node in plan 2). */
export interface Launcher {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** An MCP server the agent should start, in a transport-neutral shape. */
export interface McpServerSpec {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function devLauncher(): Launcher {
  return { command: process.execPath, args: ["--import", import.meta.resolve("tsx")], env: {} };
}

export function uiServerSpec(opts: { harnessConfig: string; bridge: string; launcher: Launcher }): McpServerSpec {
  const entry = fileURLToPath(new URL("./ui-server-bin.ts", import.meta.url));
  return {
    name: "ui",
    command: opts.launcher.command,
    args: [...opts.launcher.args, entry],
    env: { ...opts.launcher.env, HH_HARNESS: opts.harnessConfig, HH_BRIDGE: opts.bridge },
  };
}
```

`packages/blocks/src/ui-server.ts`:
```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { blockToolName, loadHarness } from "@humanharness/harness-sdk";
import { sendToBridge } from "./bridge";

/** MCP server with one tool per harness block. Valid calls are forwarded to the runtime through the bridge. */
export async function createUiServer(harnessConfig: string, bridgePath: string): Promise<McpServer> {
  const harness = await loadHarness(harnessConfig);
  const server = new McpServer({ name: "ui", version: "0.1.0" });
  for (const [name, block] of Object.entries(harness.blocks)) {
    server.registerTool(
      blockToolName(name, block),
      { description: block.description, inputSchema: block.schema.shape },
      async (args) => {
        await sendToBridge(bridgePath, { name, data: args });
        const text = block.visible ? "Done: the person can see it now." : "Done: state updated.";
        return { content: [{ type: "text" as const, text }] };
      },
    );
  }
  return server;
}
```

`packages/blocks/src/ui-server-bin.ts`:
```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createUiServer } from "./ui-server";

const harnessConfig = process.env.HH_HARNESS;
const bridgePath = process.env.HH_BRIDGE;
if (!harnessConfig || !bridgePath) {
  console.error("HH_HARNESS and HH_BRIDGE are required");
  process.exit(2);
}
const server = await createUiServer(harnessConfig, bridgePath);
await server.connect(new StdioServerTransport());
```

`packages/blocks/src/index.ts`:
```ts
export * from "./bridge";
export * from "./launch";
export { createUiServer } from "./ui-server";
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm vitest run packages/blocks && pnpm typecheck`
Expected: PASS (5 tests). If `registerTool` rejects the zod 4 shape, check the MCP SDK changelog for the supported zod import and adjust only `ui-server.ts`; the tests must stay as written.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(blocks): ui MCP server and bridge to the runtime"
```

---

### Task 8: runtime — events and error classification

**Files:**
- Create: `packages/runtime/package.json`, `packages/runtime/src/events.ts`, `packages/runtime/src/classify.ts`, `packages/runtime/src/index.ts`
- Test: `packages/runtime/test/classify.test.ts`

- [ ] **Step 1: Package manifest**

`packages/runtime/package.json`:
```json
{
  "name": "@humanharness/runtime",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@agentclientprotocol/sdk": "^1.8.0",
    "@humanharness/blocks": "workspace:*",
    "@humanharness/engines": "workspace:*",
    "@humanharness/harness-sdk": "workspace:*",
    "@humanharness/workspace": "workspace:*"
  },
  "devDependencies": {
    "@humanharness/fake-agent": "workspace:*"
  }
}
```

(`@humanharness/fake-agent` is created in Task 9; `pnpm install` runs there.)

- [ ] **Step 2: Write the failing tests**

`packages/runtime/test/classify.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { classifyError } from "../src/classify";

describe("classifyError", () => {
  it.each([
    ["Invalid API key · Please run /login", "session-expired"],
    ["Not logged in", "session-expired"],
    ["OAuth token has expired", "session-expired"],
    ["HTTP 401 Unauthorized", "session-expired"],
    ["Claude AI usage limit reached|1760000000", "out-of-quota"],
    ["You've hit your usage limit", "out-of-quota"],
    ["Rate limit exceeded (429)", "out-of-quota"],
    ["Segmentation fault", "agent-crashed"],
    ["", "agent-crashed"],
  ])("%s → %s", (text, code) => {
    expect(classifyError(text)).toBe(code);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run packages/runtime/test/classify.test.ts`
Expected: FAIL — cannot resolve `../src/classify`.

- [ ] **Step 4: Implement**

`packages/runtime/src/events.ts`:
```ts
export type ActivityKind = "read" | "edit" | "search" | "web" | "exec" | "other";

export type ErrorCode =
  | "engine-not-installed"
  | "session-expired"
  | "out-of-quota"
  | "agent-crashed"
  | "cancelled"
  | "outdated-version";

export interface EngineError {
  code: ErrorCode;
  detail?: string;
}

/** Normalized events every transport emits. Each turn ends with exactly one `done`. */
export type Event =
  | { type: "text"; delta: string }
  | { type: "paragraph" }
  | { type: "activity"; id: string; kind: ActivityKind; detail: string; state: "start" | "end"; error?: boolean }
  | { type: "block"; name: string; data: unknown }
  | { type: "done"; ok: true }
  | { type: "done"; ok: false; error: EngineError };

export function fail(code: ErrorCode, detail?: string): Event {
  return { type: "done", ok: false, error: detail ? { code, detail } : { code } };
}
```

`packages/runtime/src/classify.ts`:
```ts
import type { ErrorCode } from "./events";

const SESSION = /not logged in|\/login|invalid api key|oauth|unauthori[sz]ed|\b401\b|authentication/i;
const QUOTA = /usage limit|rate limit|limit reached|quota|\b429\b/i;

/** Maps an engine's error text to an ErrorCode. Unknown errors count as a crash. */
export function classifyError(text: string): ErrorCode {
  if (SESSION.test(text)) return "session-expired";
  if (QUOTA.test(text)) return "out-of-quota";
  return "agent-crashed";
}
```

`packages/runtime/src/index.ts`:
```ts
export * from "./events";
export { classifyError } from "./classify";
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm vitest run packages/runtime/test/classify.test.ts`
Expected: PASS (9 cases).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(runtime): normalized events and error classification"
```

---

### Task 9: fake-agent

**Files:**
- Create: `packages/fake-agent/package.json`, `packages/fake-agent/src/script.ts`, `packages/fake-agent/src/fake-claude.ts`, `packages/fake-agent/src/fake-acp.ts`, `packages/fake-agent/src/index.ts`

The fakes are exercised by the transport tests in Tasks 11–13; this task only builds them and smoke-runs the Claude one.

- [ ] **Step 1: Package manifest**

`packages/fake-agent/package.json`:
```json
{
  "name": "@humanharness/fake-agent",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@agentclientprotocol/sdk": "^1.8.0",
    "@modelcontextprotocol/sdk": "^1.32.1",
    "tsx": "^4.23.15"
  }
}
```

Run: `pnpm install`

- [ ] **Step 2: Scripts and helpers**

`packages/fake-agent/src/script.ts`:
```ts
import { writeFileSync } from "node:fs";
import path from "node:path";

/** Calls a tool on one of the MCP servers the client configured. */
export interface McpStep {
  mcp: { server: string; tool: string; args: Record<string, unknown> };
}
export interface WriteStep {
  write: { path: string; content: string };
}
export interface SleepStep {
  sleep: number;
}

export type ClaudeStep = { line: unknown } | McpStep | WriteStep | SleepStep;

/** Script for fake-claude: printed lines, side effects, then exit. */
export interface ClaudeScript {
  steps: ClaudeStep[];
  stderr?: string;
  exitCode?: number;
}

export type AcpStep =
  | { update: Record<string, unknown> }
  | { permission: { toolCall: Record<string, unknown> } }
  | McpStep
  | WriteStep
  | SleepStep
  | { error: { code: number; message: string } }
  | { stop: "end_turn" | "cancelled" | "refusal" };

/** Script for fake-acp: one array of steps per prompt turn. */
export interface AcpScript {
  loadSession?: boolean;
  sessionId?: string;
  turns: AcpStep[][];
}

export function writeScript(dir: string, script: ClaudeScript | AcpScript): string {
  const file = path.join(dir, `script-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(script));
  return file;
}

/** stream-json lines for a session start plus one streamed text block. */
export function claudeTextLines(text: string, sessionId = "fake-session"): { line: unknown }[] {
  const event = (e: unknown) => ({ line: { type: "stream_event", parent_tool_use_id: null, session_id: sessionId, event: e } });
  return [
    { line: { type: "system", subtype: "init", session_id: sessionId } },
    event({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    event({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }),
    event({ type: "content_block_stop", index: 0 }),
  ];
}

export function claudeResultLine(ok: boolean, result = "", sessionId = "fake-session"): { line: unknown } {
  return {
    line: ok
      ? { type: "result", subtype: "success", is_error: false, result, session_id: sessionId }
      : { type: "result", subtype: "error_during_execution", is_error: true, result, session_id: sessionId },
  };
}
```

`packages/fake-agent/src/mcp-call.ts`:
```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface StdioServer {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export async function callMcpTool(server: StdioServer, tool: string, args: Record<string, unknown>): Promise<void> {
  const client = new Client({ name: "fake-agent", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: { ...(process.env as Record<string, string>), ...server.env },
    }),
  );
  try {
    await client.callTool({ name: tool, arguments: args });
  } finally {
    await client.close();
  }
}
```

`packages/fake-agent/src/fake-claude.ts`:
```ts
// Stand-in for `claude -p ... --output-format stream-json`. Reads its script from HH_FAKE_SCRIPT
// and records its argv in HH_FAKE_ARGS so tests can assert on the flags the runtime passed.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { callMcpTool } from "./mcp-call";
import type { ClaudeScript } from "./script";

const argv = process.argv.slice(2);
if (process.env.HH_FAKE_ARGS) writeFileSync(process.env.HH_FAKE_ARGS, JSON.stringify(argv));
const script = JSON.parse(readFileSync(process.env.HH_FAKE_SCRIPT!, "utf8")) as ClaudeScript;
const mcpIndex = argv.indexOf("--mcp-config");
const mcpConfig = mcpIndex >= 0 ? (JSON.parse(argv[mcpIndex + 1]) as { mcpServers: Record<string, any> }) : { mcpServers: {} };

for (const step of script.steps) {
  if ("line" in step) process.stdout.write(JSON.stringify(step.line) + "\n");
  else if ("sleep" in step) await new Promise((r) => setTimeout(r, step.sleep));
  else if ("write" in step) {
    mkdirSync(path.dirname(path.resolve(step.write.path)), { recursive: true });
    writeFileSync(path.resolve(step.write.path), step.write.content);
  } else if ("mcp" in step) {
    const s = mcpConfig.mcpServers[step.mcp.server];
    await callMcpTool({ command: s.command, args: s.args ?? [], env: s.env ?? {} }, step.mcp.tool, step.mcp.args);
  }
}
if (script.stderr) process.stderr.write(script.stderr);
process.exit(script.exitCode ?? 0);
```

`packages/fake-agent/src/fake-acp.ts`:
```ts
// Stand-in ACP agent. Reads its script from HH_FAKE_SCRIPT; appends every request it receives,
// and every permission outcome, as JSON lines to HH_FAKE_LOG.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { callMcpTool } from "./mcp-call";
import type { AcpScript } from "./script";

const script = JSON.parse(readFileSync(process.env.HH_FAKE_SCRIPT!, "utf8")) as AcpScript;
const log = (method: string, params: unknown) => {
  if (process.env.HH_FAKE_LOG) appendFileSync(process.env.HH_FAKE_LOG, JSON.stringify({ method, params }) + "\n");
};

type StdioMcp = { name: string; command: string; args: string[]; env: { name: string; value: string }[] };
let mcpServers: StdioMcp[] = [];
let cwd = process.cwd();
let turn = 0;
let cancelled = false;

const stream = acp.ndJsonStream(
  Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
  Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
);

acp
  .agent({ name: "fake-acp" })
  .onRequest("initialize", (ctx) => {
    log("initialize", ctx.params);
    return { protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: { loadSession: Boolean(script.loadSession) } };
  })
  .onRequest("session/new", (ctx) => {
    log("session/new", ctx.params);
    mcpServers = (ctx.params.mcpServers ?? []) as StdioMcp[];
    cwd = ctx.params.cwd;
    return { sessionId: script.sessionId ?? "fake-acp-session" };
  })
  .onRequest("session/load", (ctx) => {
    log("session/load", ctx.params);
    mcpServers = (ctx.params.mcpServers ?? []) as StdioMcp[];
    cwd = ctx.params.cwd;
    return {};
  })
  .onNotification("session/cancel", (ctx) => {
    log("session/cancel", ctx.params);
    cancelled = true;
  })
  .onRequest("session/prompt", async (ctx) => {
    log("session/prompt", ctx.params);
    cancelled = false;
    const sessionId = ctx.params.sessionId;
    for (const step of script.turns[turn++] ?? [{ stop: "end_turn" }]) {
      if (cancelled) return { stopReason: "cancelled" as const };
      if ("update" in step) {
        await ctx.client.notify("session/update", { sessionId, update: step.update as never });
      } else if ("permission" in step) {
        const res = await ctx.client.request("session/request_permission", {
          sessionId,
          toolCall: step.permission.toolCall as never,
          options: [
            { optionId: "allow", name: "Allow", kind: "allow_once" },
            { optionId: "reject", name: "Reject", kind: "reject_once" },
          ],
        });
        log("permission-outcome", res.outcome);
      } else if ("mcp" in step) {
        const s = mcpServers.find((m) => m.name === step.mcp.server)!;
        const env = Object.fromEntries(s.env.map((e) => [e.name, e.value]));
        await callMcpTool({ command: s.command, args: s.args, env }, step.mcp.tool, step.mcp.args);
      } else if ("write" in step) {
        const file = path.resolve(cwd, step.write.path);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, step.write.content);
      } else if ("sleep" in step) {
        await new Promise((r) => setTimeout(r, step.sleep));
      } else if ("error" in step) {
        throw new acp.RequestError(step.error.code, step.error.message);
      } else if ("stop" in step) {
        return { stopReason: step.stop };
      }
    }
    return { stopReason: cancelled ? ("cancelled" as const) : ("end_turn" as const) };
  })
  .connect(stream);
```

`packages/fake-agent/src/index.ts`:
```ts
import { fileURLToPath } from "node:url";

export * from "./script";

const tsx = () => import.meta.resolve("tsx");
const entry = (file: string) => fileURLToPath(new URL(file, import.meta.url));

/** Command that starts the fake `claude` CLI. Pass it as the transport command. */
export function fakeClaudeCommand(): string[] {
  return [process.execPath, "--import", tsx(), entry("./fake-claude.ts")];
}

/** Command that starts the fake ACP agent. */
export function fakeAcpCommand(): string[] {
  return [process.execPath, "--import", tsx(), entry("./fake-acp.ts")];
}
```

- [ ] **Step 3: Smoke-run the Claude fake**

```bash
printf '{"steps":[{"line":{"type":"system","session_id":"x"}}],"exitCode":3}' > /tmp/hh-script.json
HH_FAKE_SCRIPT=/tmp/hh-script.json pnpm exec tsx packages/fake-agent/src/fake-claude.ts -p hi; echo "exit=$?"
```
Expected: prints `{"type":"system","session_id":"x"}` then `exit=3`.

- [ ] **Step 4: Typecheck and commit**

Run: `pnpm typecheck`
Expected: clean.

```bash
git add -A
git commit -m "feat(fake-agent): scripted stand-ins for claude -p and an ACP agent"
```

---

### Task 10: runtime — transport contract and session store

**Files:**
- Create: `packages/runtime/src/transport.ts`, `packages/runtime/src/session-store.ts`
- Modify: `packages/runtime/src/index.ts`
- Test: `packages/runtime/test/session-store.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/runtime/test/session-store.test.ts`:
```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readSession, writeSession } from "../src/session-store";

describe("session store", () => {
  it("creates a fresh session when there is none", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
    const s = await readSession(folder, "claude");
    expect(s.started).toBe(false);
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("round-trips a session for the same engine", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
    await writeSession(folder, "claude", { id: "abc", started: true });
    expect(await readSession(folder, "claude")).toEqual({ id: "abc", started: true });
    expect(fs.existsSync(path.join(folder, ".harness", "session.json"))).toBe(true);
  });

  it("starts over when the engine changed", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
    await writeSession(folder, "claude", { id: "abc", started: true });
    expect((await readSession(folder, "codex")).started).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/runtime/test/session-store.test.ts`
Expected: FAIL — cannot resolve `../src/session-store`.

- [ ] **Step 3: Implement**

`packages/runtime/src/transport.ts`:
```ts
import type { McpServerSpec } from "@humanharness/blocks";
import type { Permissions } from "@humanharness/harness-sdk";
import type { Event } from "./events";

export interface Session {
  id: string;
  /** False until the engine has created the session; then turns resume it. */
  started: boolean;
}

export interface TransportOptions {
  folder: string;
  session: Session;
  mcp: McpServerSpec[];
  permissions: Permissions;
  /** The CLI to run: [binary, ...leading args]. */
  command: string[];
  /** Extra environment for the CLI (tests and dev only; never credentials). */
  env?: Record<string, string>;
  onSessionStarted: (session: Session) => void;
}

export interface Transport {
  /** Runs one turn. Emits events and always finishes with exactly one `done` event before resolving. */
  turn(message: string, emit: (event: Event) => void, signal: AbortSignal): Promise<void>;
  close(): Promise<void>;
}
```

`packages/runtime/src/session-store.ts`:
```ts
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Session } from "./transport";

const file = (folder: string) => path.join(folder, ".harness", "session.json");

export async function readSession(folder: string, engineId: string): Promise<Session> {
  try {
    const saved = JSON.parse(await fs.readFile(file(folder), "utf8")) as Session & { engine: string };
    if (saved.engine === engineId) return { id: saved.id, started: saved.started };
  } catch {
    // no session yet
  }
  return { id: randomUUID(), started: false };
}

export async function writeSession(folder: string, engineId: string, session: Session): Promise<void> {
  await fs.mkdir(path.dirname(file(folder)), { recursive: true });
  await fs.writeFile(file(folder), JSON.stringify({ engine: engineId, ...session }));
}
```

Replace `packages/runtime/src/index.ts`:
```ts
export * from "./events";
export * from "./transport";
export { classifyError } from "./classify";
export { readSession, writeSession } from "./session-store";
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/runtime && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(runtime): transport contract and session store"
```

---

### Task 11: runtime — claude-cli transport

**Files:**
- Create: `packages/runtime/src/claude-cli.ts`
- Modify: `packages/runtime/src/index.ts`
- Test: `packages/runtime/test/claude-cli.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/runtime/test/claude-cli.test.ts`:
```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type ClaudeScript, claudeResultLine, claudeTextLines, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { ClaudeCliTransport, allowedTools, claudeArgs } from "../src/claude-cli";
import type { Event } from "../src/events";
import type { Session, TransportOptions } from "../src/transport";

const permissions = { edit: "folder" as const, exec: false, web: false };
const uiServer = { name: "ui", command: "node", args: ["ui.js"], env: { HH_BRIDGE: "/tmp/x.sock" } };

function setup(script: ClaudeScript, session: Session = { id: "11111111-1111-1111-1111-111111111111", started: false }) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
  const argsFile = path.join(folder, "..", `args-${path.basename(folder)}.json`);
  const started: Session[] = [];
  const opts: TransportOptions = {
    folder,
    session,
    mcp: [uiServer],
    permissions,
    command: fakeClaudeCommand(),
    env: { HH_FAKE_SCRIPT: writeScript(os.tmpdir(), script), HH_FAKE_ARGS: argsFile },
    onSessionStarted: (s) => started.push(s),
  };
  return { transport: new ClaudeCliTransport(opts), folder, started, args: () => JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[] };
}

async function run(t: ClaudeCliTransport, message = "hi", signal = new AbortController().signal) {
  const events: Event[] = [];
  await t.turn(message, (e) => events.push(e), signal);
  return events;
}

describe("allowedTools", () => {
  it("derives the whitelist from permissions and MCP servers", () => {
    expect(allowedTools({ edit: "folder", exec: false, web: true }, [uiServer])).toEqual([
      "Read", "Glob", "Grep", "TodoWrite", "Edit", "Write", "MultiEdit", "WebSearch", "WebFetch", "mcp__ui",
    ]);
    expect(allowedTools({ edit: "none", exec: true, web: false }, [])).toEqual(["Read", "Glob", "Grep", "TodoWrite", "Bash"]);
  });
});

describe("claudeArgs", () => {
  it("starts a new session with a fixed id and inline MCP config", () => {
    const args = claudeArgs("hello", { session: { id: "abc", started: false }, mcp: [uiServer], permissions });
    expect(args.slice(0, 2)).toEqual(["-p", "hello"]);
    expect(args).toContain("--strict-mcp-config");
    expect(args[args.indexOf("--session-id") + 1]).toBe("abc");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
    expect(args[args.indexOf("--disallowedTools") + 1]).toBe("AskUserQuestion");
    const config = JSON.parse(args[args.indexOf("--mcp-config") + 1]);
    expect(config).toEqual({ mcpServers: { ui: { type: "stdio", command: "node", args: ["ui.js"], env: { HH_BRIDGE: "/tmp/x.sock" } } } });
  });

  it("resumes a started session", () => {
    const args = claudeArgs("hello", { session: { id: "abc", started: true }, mcp: [], permissions });
    expect(args[args.indexOf("--resume") + 1]).toBe("abc");
    expect(args).not.toContain("--session-id");
  });
});

describe("ClaudeCliTransport", () => {
  it("streams text and reports success", async () => {
    const { transport, started, args } = setup({ steps: [...claudeTextLines("Hello there"), claudeResultLine(true, "Hello there")] });
    const events = await run(transport, "say hi");
    expect(events).toEqual([{ type: "text", delta: "Hello there" }, { type: "done", ok: true }]);
    expect(started).toEqual([{ id: "11111111-1111-1111-1111-111111111111", started: true }]);
    expect(args()[1]).toBe("say hi");
  });

  it("reports tool activity and hides ui tools", async () => {
    const toolUse = (id: string, name: string, input: unknown) => ({
      line: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id, name, input }] } },
    });
    const toolResult = (id: string) => ({
      line: { type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: id, is_error: false }] } },
    });
    const { transport } = setup({
      steps: [
        toolUse("t1", "Read", { file_path: "/x/notes/a.md" }),
        toolResult("t1"),
        toolUse("t2", "mcp__ui__show_note", { title: "x" }),
        toolResult("t2"),
        ...claudeTextLines("Done"),
        claudeResultLine(true),
      ],
    });
    const events = await run(transport);
    expect(events).toEqual([
      { type: "activity", id: "t1", kind: "read", detail: "a.md", state: "start" },
      { type: "activity", id: "t1", kind: "read", detail: "a.md", state: "end", error: false },
      { type: "text", delta: "Done" },
      { type: "done", ok: true },
    ]);
  });

  it("separates text blocks with a paragraph event", async () => {
    const { transport } = setup({ steps: [...claudeTextLines("One"), ...claudeTextLines("Two"), claudeResultLine(true)] });
    const events = await run(transport);
    expect(events.map((e) => e.type)).toEqual(["text", "paragraph", "text", "done"]);
  });

  it("classifies an error result", async () => {
    const { transport } = setup({ steps: [claudeResultLine(false, "Claude AI usage limit reached")], exitCode: 1 });
    const events = await run(transport);
    expect(events.at(-1)).toEqual({ type: "done", ok: false, error: { code: "out-of-quota", detail: "Claude AI usage limit reached" } });
  });

  it("classifies stderr when the process fails without a result", async () => {
    const { transport } = setup({ steps: [], stderr: "Invalid API key · Please run /login", exitCode: 1 });
    const events = await run(transport);
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "session-expired" } });
  });

  it("reports a missing binary", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
    const t = new ClaudeCliTransport({
      folder,
      session: { id: "x", started: false },
      mcp: [],
      permissions,
      command: [path.join(folder, "no-such-claude")],
      onSessionStarted: () => {},
    });
    const events = await run(t);
    expect(events).toEqual([{ type: "done", ok: false, error: { code: "engine-not-installed", detail: expect.any(String) } }]);
  });

  it("cancels a running turn", async () => {
    const { transport } = setup({ steps: [{ sleep: 10_000 }] });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const events = await run(transport, "hi", controller.signal);
    expect(events).toEqual([{ type: "done", ok: false, error: { code: "cancelled" } }]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run packages/runtime/test/claude-cli.test.ts`
Expected: FAIL — cannot resolve `../src/claude-cli`.

- [ ] **Step 3: Implement**

`packages/runtime/src/claude-cli.ts`:
```ts
import { spawn } from "node:child_process";
import path from "node:path";
import type { McpServerSpec } from "@humanharness/blocks";
import type { Permissions } from "@humanharness/harness-sdk";
import { classifyError } from "./classify";
import { type ActivityKind, type Event, fail } from "./events";
import type { Transport, TransportOptions } from "./transport";

const UI_TOOL_PREFIX = "mcp__ui__";

export function allowedTools(permissions: Permissions, mcp: McpServerSpec[]): string[] {
  const tools = ["Read", "Glob", "Grep", "TodoWrite"];
  if (permissions.edit === "folder") tools.push("Edit", "Write", "MultiEdit");
  if (permissions.web) tools.push("WebSearch", "WebFetch");
  if (permissions.exec) tools.push("Bash");
  for (const server of mcp) tools.push(`mcp__${server.name}`);
  return tools;
}

/** Arguments for the unmodified official `claude` binary. Never touches credentials or auth settings. */
export function claudeArgs(message: string, o: Pick<TransportOptions, "session" | "mcp" | "permissions">): string[] {
  const mcpServers = Object.fromEntries(
    o.mcp.map((s) => [s.name, { type: "stdio", command: s.command, args: s.args, env: s.env }]),
  );
  return [
    "-p", message,
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--setting-sources", "project",
    "--permission-mode", o.permissions.edit === "folder" ? "acceptEdits" : "default",
    "--allowedTools", allowedTools(o.permissions, o.mcp).join(","),
    "--disallowedTools", "AskUserQuestion",
    "--strict-mcp-config",
    "--mcp-config", JSON.stringify({ mcpServers }),
    ...(o.session.started ? ["--resume", o.session.id] : ["--session-id", o.session.id]),
  ];
}

const KINDS: Record<string, ActivityKind> = {
  Read: "read", Glob: "search", Grep: "search", Edit: "edit", Write: "edit", MultiEdit: "edit",
  NotebookEdit: "edit", WebSearch: "web", WebFetch: "web", Bash: "exec",
};

function detailOf(input: Record<string, unknown>): string {
  for (const key of ["file_path", "path", "pattern", "url", "query", "command"]) {
    const value = input[key];
    if (typeof value === "string") return key === "file_path" || key === "path" ? path.basename(value) : value;
  }
  return "";
}

/** Turns Claude Code's stream-json lines into normalized events. */
export class StreamJsonReader {
  private textOpen = false;
  private hasText = false;
  private tools = new Map<string, { kind: ActivityKind; detail: string }>();
  resultError: string | null = null;

  constructor(
    private readonly emit: (e: Event) => void,
    private readonly onSessionId: (id: string) => void,
  ) {}

  feed(line: string): void {
    let o: Record<string, any>;
    try {
      o = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof o.session_id === "string") this.onSessionId(o.session_id);
    if ((o.parent_tool_use_id ?? null) !== null) return;

    if (o.type === "stream_event") {
      const ev = o.event ?? {};
      if (ev.type === "content_block_start" && ev.content_block?.type === "text") {
        if (this.hasText) this.emit({ type: "paragraph" });
        this.textOpen = true;
      } else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && this.textOpen && ev.delta.text) {
        this.hasText = true;
        this.emit({ type: "text", delta: ev.delta.text });
      } else if (ev.type === "content_block_stop") {
        this.textOpen = false;
      }
      return;
    }

    if (o.type === "assistant") {
      for (const b of o.message?.content ?? []) {
        if (b.type !== "tool_use" || String(b.name).startsWith(UI_TOOL_PREFIX)) continue;
        const activity = { kind: KINDS[b.name] ?? ("other" as const), detail: detailOf(b.input ?? {}) };
        this.tools.set(b.id, activity);
        this.emit({ type: "activity", id: b.id, ...activity, state: "start" });
      }
      return;
    }

    if (o.type === "user" && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) {
        if (b.type !== "tool_result") continue;
        const activity = this.tools.get(b.tool_use_id);
        if (!activity) continue;
        this.tools.delete(b.tool_use_id);
        this.emit({ type: "activity", id: b.tool_use_id, ...activity, state: "end", error: Boolean(b.is_error) });
      }
      return;
    }

    if (o.type === "result" && (o.is_error || (o.subtype && o.subtype !== "success"))) {
      this.resultError = (typeof o.result === "string" && o.result) || "Claude Code could not finish the request.";
    }
  }
}

/** Runs one `claude -p` process per turn, resuming the session by id. */
export class ClaudeCliTransport implements Transport {
  constructor(private readonly o: TransportOptions) {}

  private markStarted = (): void => {
    if (this.o.session.started) return;
    this.o.session = { id: this.o.session.id, started: true };
    this.o.onSessionStarted(this.o.session);
  };

  turn(message: string, emit: (e: Event) => void, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      let finished = false;
      const finish = (e: Event) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener("abort", onAbort);
        emit(e);
        resolve();
      };
      const [binary, ...leading] = this.o.command;
      const child = spawn(binary, [...leading, ...claudeArgs(message, this.o)], {
        cwd: this.o.folder,
        env: { ...process.env, ...this.o.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const onAbort = () => child.kill("SIGTERM");
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();

      const reader = new StreamJsonReader(emit, this.markStarted);
      let rest = "";
      child.stdout!.setEncoding("utf8");
      child.stdout!.on("data", (chunk: string) => {
        rest += chunk;
        let i: number;
        while ((i = rest.indexOf("\n")) >= 0) {
          const line = rest.slice(0, i).trim();
          rest = rest.slice(i + 1);
          if (line) reader.feed(line);
        }
      });
      let stderr = "";
      child.stderr!.setEncoding("utf8");
      child.stderr!.on("data", (c: string) => (stderr = (stderr + c).slice(-4000)));

      child.on("error", (e: NodeJS.ErrnoException) =>
        finish(fail(e.code === "ENOENT" ? "engine-not-installed" : "agent-crashed", e.message)),
      );
      child.on("close", (code) => {
        if (signal.aborted) finish(fail("cancelled"));
        else if (reader.resultError) finish(fail(classifyError(reader.resultError), reader.resultError));
        else if (code !== 0) finish(fail(classifyError(stderr), stderr.trim() || `exit code ${code}`));
        else finish({ type: "done", ok: true });
      });
    });
  }

  async close(): Promise<void> {}
}
```

Append to `packages/runtime/src/index.ts`:
```ts
export { ClaudeCliTransport, allowedTools, claudeArgs } from "./claude-cli";
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run packages/runtime && pnpm typecheck`
Expected: PASS (all claude-cli tests plus earlier ones).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(runtime): claude-cli transport over the official binary"
```

---

### Task 12: runtime — ACP transport

**Files:**
- Create: `packages/runtime/src/acp.ts`
- Modify: `packages/runtime/src/index.ts`
- Test: `packages/runtime/test/acp.test.ts`

Use the spike findings: if the MCP `tool_call` title does not contain `show_<name>`/`update_<name>`, change `isUiTool` to match what the spike recorded, and adjust the "hides ui tools" test fixture to that title. If the spike showed MCP calls arriving as permission requests with a kind other than `other`, add that kind to the allow rule for MCP tools.

- [ ] **Step 1: Write the failing tests**

`packages/runtime/test/acp.test.ts`:
```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type AcpScript, fakeAcpCommand, writeScript } from "@humanharness/fake-agent";
import { AcpTransport, decidePermission, isUiTool } from "../src/acp";
import type { Event } from "../src/events";
import type { Session } from "../src/transport";

const permissions = { edit: "folder" as const, exec: false, web: false };
let transport: AcpTransport | undefined;

afterEach(async () => {
  await transport?.close();
  transport = undefined;
});

function setup(scriptOrFn: AcpScript | ((folder: string) => AcpScript), session: Session = { id: "local-id", started: false }) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
  const script = typeof scriptOrFn === "function" ? scriptOrFn(folder) : scriptOrFn;
  const logFile = path.join(folder, "..", `log-${path.basename(folder)}.jsonl`);
  const started: Session[] = [];
  transport = new AcpTransport({
    folder,
    session,
    mcp: [{ name: "ui", command: "node", args: ["ui.js"], env: { HH_BRIDGE: "/tmp/x.sock" } }],
    permissions,
    command: fakeAcpCommand(),
    env: { HH_FAKE_SCRIPT: writeScript(os.tmpdir(), script), HH_FAKE_LOG: logFile },
    onSessionStarted: (s) => started.push(s),
  });
  const log = () =>
    fs.existsSync(logFile)
      ? fs.readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { method: string; params: any })
      : [];
  return { transport, folder, started, log };
}

async function run(t: AcpTransport, message = "hi", signal = new AbortController().signal) {
  const events: Event[] = [];
  await t.turn(message, (e) => events.push(e), signal);
  return events;
}

const chunk = (text: string) => ({ update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } });

describe("decidePermission", () => {
  const options = [
    { optionId: "allow", name: "Allow", kind: "allow_once" as const },
    { optionId: "reject", name: "Reject", kind: "reject_once" as const },
  ];
  const ask = (toolCall: Record<string, unknown>, perms = permissions) =>
    decidePermission({ sessionId: "s", toolCall: { toolCallId: "t", ...toolCall }, options } as never, "/work", perms);
  const selected = (r: ReturnType<typeof decidePermission>) => (r.outcome.outcome === "selected" ? r.outcome.optionId : "cancelled");

  it("allows edits inside the folder only", () => {
    expect(selected(ask({ kind: "edit", locations: [{ path: "/work/a.md" }] }))).toBe("allow");
    expect(selected(ask({ kind: "edit", locations: [{ path: "/etc/passwd" }] }))).toBe("reject");
    expect(selected(ask({ kind: "edit", locations: [{ path: "/work/../etc/x" }] }))).toBe("reject");
  });

  it("follows the manifest for exec and web", () => {
    expect(selected(ask({ kind: "execute" }))).toBe("reject");
    expect(selected(ask({ kind: "execute" }, { ...permissions, exec: true }))).toBe("allow");
    expect(selected(ask({ kind: "fetch" }))).toBe("reject");
  });

  it("allows ui tools and reads inside the folder", () => {
    expect(selected(ask({ kind: "other", title: "ui.show_note" }))).toBe("allow");
    expect(selected(ask({ kind: "read", locations: [{ path: "/work/x" }] }))).toBe("allow");
  });

  it("rejects edits when the harness cannot edit", () => {
    expect(selected(ask({ kind: "edit", locations: [{ path: "/work/a.md" }] }, { ...permissions, edit: "none" }))).toBe("reject");
  });
});

describe("isUiTool", () => {
  it("matches block tools only", () => {
    expect(isUiTool("ui.show_note")).toBe(true);
    expect(isUiTool("mcp__ui__update_progress")).toBe(true);
    expect(isUiTool("Read file")).toBe(false);
  });
});

describe("AcpTransport", () => {
  it("creates a session with cwd and MCP servers, then streams text", async () => {
    const { transport, folder, started, log } = setup({ sessionId: "agent-1", turns: [[chunk("Hello"), { stop: "end_turn" }]] });
    const events = await run(transport);
    expect(events).toEqual([{ type: "text", delta: "Hello" }, { type: "done", ok: true }]);
    expect(started).toEqual([{ id: "agent-1", started: true }]);
    const newSession = log().find((l) => l.method === "session/new")!;
    expect(newSession.params.cwd).toBe(folder);
    expect(newSession.params.mcpServers).toEqual([
      { name: "ui", command: "node", args: ["ui.js"], env: [{ name: "HH_BRIDGE", value: "/tmp/x.sock" }] },
    ]);
  });

  it("reuses one agent process across turns", async () => {
    const { transport, log } = setup({ turns: [[chunk("a")], [chunk("b")]] });
    await run(transport);
    await run(transport);
    expect(log().filter((l) => l.method === "initialize")).toHaveLength(1);
    expect(log().filter((l) => l.method === "session/prompt")).toHaveLength(2);
  });

  it("loads a started session when the agent supports it", async () => {
    const { transport, log } = setup({ loadSession: true, turns: [[chunk("again")]] }, { id: "old-1", started: true });
    await run(transport);
    expect(log().find((l) => l.method === "session/load")?.params.sessionId).toBe("old-1");
    expect(log().some((l) => l.method === "session/new")).toBe(false);
  });

  it("answers permission requests from the manifest policy", async () => {
    const { transport, log } = setup((folder) => ({ turns: [[
      { permission: { toolCall: { toolCallId: "e1", title: "Write", kind: "edit", locations: [{ path: path.join(folder, "a.md") }] } } },
      { permission: { toolCall: { toolCallId: "x1", title: "rm -rf", kind: "execute" } } },
    ]] }));
    await run(transport);
    expect(log().filter((l) => l.method === "permission-outcome").map((l) => l.params)).toEqual([
      { outcome: "selected", optionId: "allow" },
      { outcome: "selected", optionId: "reject" },
    ]);
  });

  it("reports tool activity, hides ui tools and adds a paragraph after tools", async () => {
    const { transport } = setup({ turns: [[
      chunk("Looking"),
      { update: { sessionUpdate: "tool_call", toolCallId: "r1", title: "Read notes/a.md", kind: "read", status: "pending" } },
      { update: { sessionUpdate: "tool_call_update", toolCallId: "r1", status: "completed" } },
      { update: { sessionUpdate: "tool_call", toolCallId: "u1", title: "ui.show_note", kind: "other", status: "pending" } },
      { update: { sessionUpdate: "tool_call_update", toolCallId: "u1", status: "completed" } },
      chunk("Done"),
    ]] });
    const events = await run(transport);
    expect(events).toEqual([
      { type: "text", delta: "Looking" },
      { type: "activity", id: "r1", kind: "read", detail: "Read notes/a.md", state: "start" },
      { type: "activity", id: "r1", kind: "read", detail: "Read notes/a.md", state: "end", error: false },
      { type: "paragraph" },
      { type: "text", delta: "Done" },
      { type: "done", ok: true },
    ]);
  });

  it("maps auth_required to session-expired", async () => {
    const { transport } = setup({ turns: [[{ error: { code: -32000, message: "Authentication required" } }]] });
    const events = await run(transport);
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "session-expired" } });
  });

  it("maps quota errors to out-of-quota", async () => {
    const { transport } = setup({ turns: [[{ error: { code: -32603, message: "You've hit your usage limit" } }]] });
    const events = await run(transport);
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "out-of-quota" } });
  });

  it("cancels through session/cancel", async () => {
    const { transport, log } = setup({ turns: [[{ sleep: 500 }, chunk("too late")]] });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const events = await run(transport, "hi", controller.signal);
    expect(events).toEqual([{ type: "done", ok: false, error: { code: "cancelled" } }]);
    expect(log().some((l) => l.method === "session/cancel")).toBe(true);
  });

  it("reports a missing binary", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
    transport = new AcpTransport({
      folder,
      session: { id: "x", started: false },
      mcp: [],
      permissions,
      command: [path.join(folder, "no-such-agent")],
      onSessionStarted: () => {},
    });
    const events = await run(transport);
    expect(events).toEqual([{ type: "done", ok: false, error: { code: "engine-not-installed", detail: expect.any(String) } }]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run packages/runtime/test/acp.test.ts`
Expected: FAIL — cannot resolve `../src/acp`.

- [ ] **Step 3: Implement**

`packages/runtime/src/acp.ts`:
```ts
import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { Permissions } from "@humanharness/harness-sdk";
import { classifyError } from "./classify";
import { type ActivityKind, type Event, fail } from "./events";
import type { Transport, TransportOptions } from "./transport";

type PermissionOption = { optionId: string; kind: string };
type PermissionRequest = {
  toolCall: { title?: string | null; kind?: string | null; locations?: { path: string }[] | null };
  options: PermissionOption[];
};
type PermissionResponse = { outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" } };

const UI_TOOL = /(^|[._])(show|update)_[a-z0-9_]+$/;

export function isUiTool(title: string | null | undefined): boolean {
  return UI_TOOL.test(title ?? "");
}

function inside(folder: string, target: string): boolean {
  const root = path.resolve(folder);
  const resolved = path.resolve(root, target);
  return resolved === root || resolved.startsWith(root + path.sep);
}

/** Answers ACP permission requests from the harness manifest, without asking the user. */
export function decidePermission(params: PermissionRequest, folder: string, permissions: Permissions): PermissionResponse {
  const { kind = "other", locations = [], title } = params.toolCall;
  const allInside = (locations ?? []).every((l) => inside(folder, l.path));
  let allow: boolean;
  if (isUiTool(title)) allow = true;
  else if (kind === "read" || kind === "search" || kind === "think") allow = allInside;
  else if (kind === "edit" || kind === "delete" || kind === "move") allow = permissions.edit === "folder" && allInside;
  else if (kind === "fetch") allow = permissions.web;
  else if (kind === "execute") allow = permissions.exec;
  else allow = true; // "other": MCP tools bundled with the harness
  const wanted = allow ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"];
  const option = params.options.find((o) => wanted.includes(o.kind));
  return option ? { outcome: { outcome: "selected", optionId: option.optionId } } : { outcome: { outcome: "cancelled" } };
}

const KINDS: Record<string, ActivityKind> = {
  read: "read", search: "search", edit: "edit", delete: "edit", move: "edit", fetch: "web", execute: "exec",
};

function errorFrom(e: unknown): Event {
  const err = e as { code?: unknown; message?: string };
  if (err?.code === "ENOENT") return fail("engine-not-installed", err.message);
  if (e instanceof acp.RequestError && e.code === -32000) return fail("session-expired", e.message);
  const message = err?.message ?? String(e);
  return fail(classifyError(message), message);
}

/** Long-lived ACP agent per window; one `session/prompt` per turn. */
export class AcpTransport implements Transport {
  private child?: ChildProcess;
  private conn?: acp.ClientConnection;
  private sessionId?: string;
  private emit: ((e: Event) => void) | null = null;
  private uiCalls = new Set<string>();
  private activities = new Map<string, { kind: ActivityKind; detail: string }>();
  private afterTool = false;

  constructor(private readonly o: TransportOptions) {}

  private async start(): Promise<void> {
    const [binary, ...args] = this.o.command;
    const child = spawn(binary, args, {
      cwd: this.o.folder,
      env: { ...process.env, ...this.o.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.on("exit", () => this.reset());
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", reject);
    });
    child.stderr!.resume();

    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
    );
    this.conn = acp
      .client({ name: "humanharness" })
      .onRequest("session/request_permission", (ctx) =>
        decidePermission(ctx.params as PermissionRequest, this.o.folder, this.o.permissions) as never,
      )
      .onNotification("session/update", (ctx) => this.onUpdate(ctx.params.update as Record<string, any>))
      .connect(stream);

    const agent = this.conn.agent;
    const init = await agent.request("initialize", {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });
    const mcpServers = this.o.mcp.map((s) => ({
      name: s.name,
      command: s.command,
      args: s.args,
      env: Object.entries(s.env).map(([name, value]) => ({ name, value })),
    }));
    if (this.o.session.started && init.agentCapabilities?.loadSession) {
      await agent.request("session/load", { sessionId: this.o.session.id, cwd: this.o.folder, mcpServers });
      this.sessionId = this.o.session.id;
    } else {
      const created = await agent.request("session/new", { cwd: this.o.folder, mcpServers });
      this.sessionId = created.sessionId;
      this.o.session = { id: created.sessionId, started: true };
      this.o.onSessionStarted(this.o.session);
    }
  }

  private reset(): void {
    this.conn = undefined;
    this.child = undefined;
    this.sessionId = undefined;
  }

  private onUpdate(u: Record<string, any>): void {
    const emit = this.emit;
    if (!emit) return;
    switch (u.sessionUpdate) {
      case "agent_message_chunk":
        if (u.content?.type !== "text" || !u.content.text) return;
        if (this.afterTool) {
          emit({ type: "paragraph" });
          this.afterTool = false;
        }
        emit({ type: "text", delta: u.content.text });
        return;
      case "tool_call": {
        if (isUiTool(u.title)) {
          this.uiCalls.add(u.toolCallId);
          return;
        }
        const activity = { kind: KINDS[u.kind] ?? ("other" as const), detail: String(u.title ?? "") };
        this.activities.set(u.toolCallId, activity);
        this.afterTool = true;
        emit({ type: "activity", id: u.toolCallId, ...activity, state: "start" });
        return;
      }
      case "tool_call_update": {
        if (this.uiCalls.has(u.toolCallId)) return;
        const activity = this.activities.get(u.toolCallId);
        if (!activity || (u.status !== "completed" && u.status !== "failed")) return;
        this.activities.delete(u.toolCallId);
        emit({ type: "activity", id: u.toolCallId, ...activity, state: "end", error: u.status === "failed" });
        return;
      }
    }
  }

  async turn(message: string, emit: (e: Event) => void, signal: AbortSignal): Promise<void> {
    if (!this.conn) {
      try {
        await this.start();
      } catch (e) {
        this.child?.kill();
        this.reset();
        emit(errorFrom(e));
        return;
      }
    }
    const agent = this.conn!.agent;
    const sessionId = this.sessionId!;
    this.emit = emit;
    this.afterTool = false;
    const onAbort = () => void agent.notify("session/cancel", { sessionId });
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await agent.request("session/prompt", { sessionId, prompt: [{ type: "text", text: message }] });
      if (res.stopReason === "cancelled" || signal.aborted) emit(fail("cancelled"));
      else if (res.stopReason === "refusal") emit(fail("agent-crashed", "refusal"));
      else emit({ type: "done", ok: true });
    } catch (e) {
      emit(signal.aborted ? fail("cancelled") : errorFrom(e));
    } finally {
      signal.removeEventListener("abort", onAbort);
      this.emit = null;
    }
  }

  async close(): Promise<void> {
    this.conn?.close();
    this.child?.kill();
    this.reset();
  }
}
```

Append to `packages/runtime/src/index.ts`:
```ts
export { AcpTransport, decidePermission, isUiTool } from "./acp";
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run packages/runtime && pnpm typecheck`
Expected: PASS. If `typecheck` rejects a request/notify call shape, align it with `packages/runtime/node_modules/@agentclientprotocol/sdk/dist/acp.d.ts` (the method strings above are the SDK's `methods` constants) without changing behavior.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(runtime): ACP transport with manifest-driven permissions"
```

---

### Task 13: runtime — turn orchestration

**Files:**
- Create: `packages/runtime/src/runtime.ts`
- Modify: `packages/runtime/src/index.ts`
- Test: `packages/runtime/test/runtime.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/runtime/test/runtime.test.ts`:
```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import { type ClaudeScript, claudeResultLine, claudeTextLines, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { loadHarness } from "@humanharness/harness-sdk";
import type { Event } from "../src/events";
import { type HarnessRuntime, createRuntime } from "../src/runtime";

const DEMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../harnesses/demo/harness.config.ts");
let runtime: HarnessRuntime | undefined;

afterEach(async () => {
  await runtime?.close();
  runtime = undefined;
});

async function setup(script: ClaudeScript, folder = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hh-")), "Work")) {
  const argsFile = path.join(os.tmpdir(), `args-${Date.now()}-${Math.random()}.json`);
  runtime = await createRuntime({
    harness: await loadHarness(DEMO),
    engine: getEngine("claude"),
    folder,
    gitdir: path.join(path.dirname(folder), "history.git"),
    language: "en",
    command: fakeClaudeCommand(),
    env: { HH_FAKE_SCRIPT: writeScript(os.tmpdir(), script), HH_FAKE_ARGS: argsFile },
  });
  return { runtime, folder, args: () => JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[] };
}

async function send(r: HarnessRuntime, message = "hi") {
  const events: Event[] = [];
  await r.send(message, (e) => events.push(e)).done;
  return events;
}

describe("createRuntime", () => {
  it("prepares the folder: seed, AGENTS.md with managed section, CLAUDE.md", async () => {
    const { folder } = await setup({ steps: [] });
    expect(fs.readFileSync(path.join(folder, "README.md"), "utf8")).toContain("demo app");
    const agents = fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8");
    expect(agents).toContain("You are a test assistant");
    expect(agents).toContain("`show_note`");
    expect(agents).toContain("Always answer in English.");
    expect(fs.readFileSync(path.join(folder, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
  });

  it("delivers blocks from the ui MCP server and commits the turn", async () => {
    const { runtime, folder } = await setup({
      steps: [
        ...claudeTextLines("Here is your note"),
        { mcp: { server: "ui", tool: "show_note", args: { title: "Groceries", body: "milk" } } },
        { write: { path: "notes/Groceries.md", content: "milk" } },
        claudeResultLine(true),
      ],
    });
    const events = await send(runtime, "make a note");
    expect(events).toContainEqual({ type: "block", name: "note", data: { title: "Groceries", body: "milk" } });
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
    expect(fs.readFileSync(path.join(folder, "notes/Groceries.md"), "utf8")).toBe("milk");
    expect((await runtime.history.list())[0].message).toBe("Turn: make a note");
  });

  it("rolls back the folder when the agent crashes mid-turn", async () => {
    const { runtime, folder } = await setup({
      steps: [{ write: { path: "README.md", content: "half-written" } }],
      stderr: "boom",
      exitCode: 1,
    });
    const events = await send(runtime);
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "agent-crashed" } });
    expect(fs.readFileSync(path.join(folder, "README.md"), "utf8")).toContain("demo app");
  });

  it("keeps changes when the user cancels", async () => {
    const { runtime, folder } = await setup({ steps: [{ write: { path: "kept.md", content: "x" } }, { sleep: 10_000 }] });
    const turn = runtime.send("hi", () => {});
    while (!fs.existsSync(path.join(folder, "kept.md"))) await new Promise((r) => setTimeout(r, 50));
    turn.cancel();
    await turn.done;
    expect(fs.existsSync(path.join(folder, "kept.md"))).toBe(true);
  });

  it("persists the session and resumes it in the next runtime", async () => {
    const script: ClaudeScript = { steps: [...claudeTextLines("ok"), claudeResultLine(true)] };
    const first = await setup(script);
    await send(first.runtime);
    const firstId = first.args()[first.args().indexOf("--session-id") + 1];
    await first.runtime.close();

    const second = await setup(script, first.folder);
    await send(second.runtime);
    expect(second.args()[second.args().indexOf("--resume") + 1]).toBe(firstId);
  });

  it("refuses a second turn while one is running", async () => {
    const { runtime } = await setup({ steps: [{ sleep: 2000 }] });
    const turn = runtime.send("one", () => {});
    expect(() => runtime.send("two", () => {})).toThrow(/already running/);
    turn.cancel();
    await turn.done;
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run packages/runtime/test/runtime.test.ts`
Expected: FAIL — cannot resolve `../src/runtime`.

- [ ] **Step 3: Implement**

`packages/runtime/src/runtime.ts`:
```ts
import { promises as fs } from "node:fs";
import { type Bridge, type Launcher, type McpServerSpec, devLauncher, openBridge, uiServerSpec } from "@humanharness/blocks";
import type { EngineDef } from "@humanharness/engines";
import { type Language, type LoadedHarness, resolveInHarness } from "@humanharness/harness-sdk";
import { History, prepareFolder, writeInstructions } from "@humanharness/workspace";
import { AcpTransport } from "./acp";
import { ClaudeCliTransport } from "./claude-cli";
import type { Event } from "./events";
import { readSession, writeSession } from "./session-store";
import type { Transport, TransportOptions } from "./transport";

export interface RuntimeOptions {
  harness: LoadedHarness;
  engine: EngineDef;
  /** The user's visible folder. */
  folder: string;
  /** Where the hidden history lives (outside `folder`). */
  gitdir: string;
  language: Language;
  /** How to run Node for MCP servers. Defaults to tsx (development). */
  launcher?: Launcher;
  /** Override the engine's CLI command (tests, dev). */
  command?: string[];
  /** Extra CLI environment (tests, dev). Never credentials. */
  env?: Record<string, string>;
}

export interface RunningTurn {
  cancel(): void;
  done: Promise<void>;
}

export interface HarnessRuntime {
  send(message: string, emit: (e: Event) => void): RunningTurn;
  history: History;
  close(): Promise<void>;
}

function harnessMcpServers(harness: LoadedHarness, launcher: Launcher): McpServerSpec[] {
  return harness.mcp.map((rel, i) => ({
    name: i === 0 ? harness.id : `${harness.id}-${i + 1}`,
    command: launcher.command,
    args: [...launcher.args, resolveInHarness(harness, rel)],
    env: { ...launcher.env },
  }));
}

export async function createRuntime(opts: RuntimeOptions): Promise<HarnessRuntime> {
  const { harness, engine, folder } = opts;
  const launcher = opts.launcher ?? devLauncher();

  await prepareFolder(folder, harness.folder.seed ? resolveInHarness(harness, harness.folder.seed) : undefined);
  const base = await fs.readFile(resolveInHarness(harness, harness.instructions), "utf8");
  const generated = await writeInstructions({ folder, base, language: opts.language, blocks: harness.blocks, engine });

  const history = new History(folder, opts.gitdir, [".harness/", ...generated]);
  await history.init();
  await history.save("Start");

  let emitCurrent: ((e: Event) => void) | null = null;
  const bridge: Bridge = await openBridge((m) => emitCurrent?.({ type: "block", name: m.name, data: m.data }));

  let sessionWrite: Promise<void> = Promise.resolve();
  const transportOptions: TransportOptions = {
    folder,
    session: await readSession(folder, engine.id),
    mcp: [uiServerSpec({ harnessConfig: harness.configPath, bridge: bridge.path, launcher }), ...harnessMcpServers(harness, launcher)],
    permissions: harness.permissions,
    command: opts.command ?? (engine.transport.kind === "claude-cli" ? [engine.transport.binary] : engine.transport.command),
    env: opts.env,
    onSessionStarted: (s) => {
      sessionWrite = writeSession(folder, engine.id, s);
    },
  };
  const transport: Transport =
    engine.transport.kind === "claude-cli" ? new ClaudeCliTransport(transportOptions) : new AcpTransport(transportOptions);

  let busy = false;

  return {
    history,
    send(message, emit) {
      if (busy) throw new Error("A turn is already running");
      busy = true;
      const controller = new AbortController();
      const done = (async () => {
        try {
          const before = (await history.save("Before message")) ?? (await history.last())!;
          let final: Event | undefined;
          emitCurrent = emit;
          await transport.turn(message, (e) => (e.type === "done" ? (final = e) : emit(e)), controller.signal);
          emitCurrent = null;
          await sessionWrite;
          if (final?.type === "done" && final.ok) await history.save(`Turn: ${message.slice(0, 60)}`);
          else if (final?.type === "done" && final.error.code === "agent-crashed") await history.restore(before, "Undo: the turn did not finish");
          else await history.save(`Stopped: ${message.slice(0, 60)}`);
          emit(final ?? { type: "done", ok: false, error: { code: "agent-crashed" } });
        } finally {
          emitCurrent = null;
          busy = false;
        }
      })();
      return { cancel: () => controller.abort(), done };
    },
    async close() {
      await transport.close();
      await bridge.close();
    },
  };
}
```

Append to `packages/runtime/src/index.ts`:
```ts
export { createRuntime, type HarnessRuntime, type RunningTurn, type RuntimeOptions } from "./runtime";
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run packages/runtime && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `pnpm test && pnpm typecheck`
Expected: all packages PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(runtime): turn orchestration with history and blocks"
```

---

### Task 14: dev CLI and real-engine check

**Files:**
- Create: `packages/runtime/src/dev.ts`

- [ ] **Step 1: Implement the terminal runner**

`packages/runtime/src/dev.ts`:
```ts
// Development runner: one harness turn in the terminal against a real engine.
// pnpm hh-dev --harness harnesses/demo/harness.config.ts --folder ~/tmp/demo --engine claude "make a note"
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { availableEngines } from "@humanharness/engines";
import { LANGUAGES, type Language, loadHarness } from "@humanharness/harness-sdk";
import { createRuntime } from "./runtime";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    harness: { type: "string" },
    folder: { type: "string" },
    engine: { type: "string", default: "claude" },
    language: { type: "string", default: "es" },
  },
});

const message = positionals.join(" ");
if (!values.harness || !values.folder || !message) {
  console.error('Usage: pnpm hh-dev --harness <harness.config.ts> --folder <dir> [--engine claude|codex] [--language es|en] "<message>"');
  process.exit(2);
}
if (!LANGUAGES.includes(values.language as Language)) {
  console.error(`Unknown language: ${values.language}`);
  process.exit(2);
}

const harness = await loadHarness(values.harness);
const engine = availableEngines(harness.engines, "development").find((e) => e.id === values.engine);
if (!engine) {
  console.error(`Engine "${values.engine}" is not available for ${harness.id} (or is excluded).`);
  process.exit(2);
}

const folder = path.resolve(values.folder.replace(/^~/, os.homedir()));
const runtime = await createRuntime({
  harness,
  engine,
  folder,
  gitdir: path.join(os.homedir(), ".humanharness", "dev", "history", harness.id),
  language: values.language as Language,
});

const turn = runtime.send(message, (e) => {
  if (e.type === "text") process.stdout.write(e.delta);
  else if (e.type === "paragraph") process.stdout.write("\n\n");
  else if (e.type === "activity" && e.state === "start") process.stdout.write(`\n  · ${e.kind}: ${e.detail}\n`);
  else if (e.type === "block") process.stdout.write(`\n  [${e.name}] ${JSON.stringify(e.data)}\n`);
  else if (e.type === "done") process.stdout.write(e.ok ? "\n\n✓ done\n" : `\n\n✗ ${e.error.code}${e.error.detail ? `: ${e.error.detail}` : ""}\n`);
});
process.on("SIGINT", () => turn.cancel());
await turn.done;
console.log("History:", (await runtime.history.list(3)).map((h) => h.message).join(" ← "));
await runtime.close();
```

- [ ] **Step 2: Real turn with Claude**

Run:
```bash
pnpm hh-dev --harness harnesses/demo/harness.config.ts --folder /tmp/hh-demo-claude --engine claude --language en "Make a note titled Groceries with milk and bread."
```
Expected: streamed text; a `[note] {"title":"Groceries",...}` line; a `[progress] {"percent":…}` line (state block); `✓ done`; `/tmp/hh-demo-claude/notes/Groceries.md` exists; history line starts with `Turn: Make a note`.

Run it a second time with `"Add eggs to the note."` and confirm the agent remembers the note (session resumed).

- [ ] **Step 3: Real turn with Codex**

Run:
```bash
pnpm hh-dev --harness harnesses/demo/harness.config.ts --folder /tmp/hh-demo-codex --engine codex --language es "Hacé una nota que se llame Compras con leche y pan."
```
Expected: same as Claude, answer in Spanish, `[note]` block, `✓ done`.

- [ ] **Step 4: Record results**

Append a "Plan 1 end-to-end" section to `docs/spikes/2026-10-10-transports.md` with, per engine: the command, whether blocks arrived, whether the session resumed, and any error. If something failed, write the exact error and stop: report to Marco before plan 2.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(runtime): hh-dev terminal runner; record end-to-end results"
```

---

## Done when

- `pnpm test` and `pnpm typecheck` pass from a clean clone.
- `pnpm hh-dev` runs the demo harness end to end with Claude and with Codex, delivering blocks and resuming sessions.
- `docs/spikes/2026-10-10-transports.md` records the spike and the end-to-end results.
