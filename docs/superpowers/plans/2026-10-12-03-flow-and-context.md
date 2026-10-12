# Human Harness — Plan 3: Flow and context

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every harness gets an app-driven flow and a context strategy: manifest actions become tasks with their own brief and an optional guided path, each task runs in its own engine session, the agent closes a task by calling the core `save_note` block, the app writes the note to `<folder>/.harness/notes/` and starts every new session from a short notes index. The work screen follows the "Plan 3 · Explicador" mockups (start view with topics, "Recorrido" side panel, `choices` block, "Lo que quedó claro" panel), and the demo harness becomes a read-only architecture explainer for developers.

**Architecture:** `harness-sdk` gains the core blocks (`choices`, `save_note`), action prompts, `path` and `folder.references`. `workspace` gains the notes store, the notes index and a history that tracks `.harness/notes/`. The transports learn to end a session (`--session-id` again for Claude, `session/close` for Codex) and to read reference folders (`--add-dir` for Claude, read permissions for Codex); the runtime no longer owns `session.json`. The shell gets a `TaskManager` (state machine over `.harness/tasks.json`) that drives `TurnController` with quiet closing turns, plus safe file opening and test hooks. The UI kit gets a flow mode (any harness with actions): `FlowSide`, `StartView`, `ChoicesBlock`, `NotesPanel`. Playwright drives the built Electron app against the fake agents.

**Tech Stack:** plan 2b's (Electron 44, electron-vite 5, React 19, i18next 26, Vitest 5 + happy-dom, zod 4, isomorphic-git) plus `@playwright/test` 1.63.0 (Apache-2.0) for the E2E tests (Electron only, no browser download).

Specs: `docs/superpowers/specs/2026-10-12-flow-and-context-design.md` (source of truth), `docs/superpowers/specs/2026-10-10-humanharness-core-design.md`, `docs/superpowers/specs/2026-10-11-app-look-design.md`. Mockups: "Plan 3 · Explicador" page of the mockup canvas (`ExplainerStart`, `ExplainerAnswer`, `ExplainerNotes`). Roadmap: `docs/superpowers/plans/2026-10-10-00-roadmap.md`. Previous plan: `docs/superpowers/plans/2026-10-11-02b-onboarding-usage.md`.

---

## Conventions

- Same as plans 1, 2a and 2b: English everywhere; packages export TS source; extensionless imports; tests in `packages/<name>/test/` (and, from Task 23, `harnesses/<id>/test/`); `corepack pnpm …` (pnpm is not on PATH); one commit per task, ending with the session trailers from your system reminder.
- React tests are `*.test.tsx` with `// @vitest-environment happy-dom` on the first line. UI tests find elements by role and visible text.
- Every task ends with `corepack pnpm typecheck` and `corepack pnpm test` green before its commit. Run them from the repository root.
- **Compliance (core spec §5), restated for this plan's new code:** never read `~/.claude`, `~/.codex` or `~/.gemini`; never pass, inject or strip credentials or auth environment variables; never patch a CLI; never store or log emails or credentials. Only the official CLIs, unmodified. The test hooks (Task 16) only exist in development builds and only pass `HH_FAKE_*` variables to fake agents. A reference folder that is (or contains) `~/.claude`, `~/.codex`, `~/Library`, a system folder or the whole home is refused.
- **Engine-agnostic:** the flow only uses what both engines share: the instructions file, MCP tools, new or resumed sessions, compaction. The notes index goes in the first user message, never in `AGENTS.md`, so the instructions stay a stable, cacheable prefix.
- Colours only through the existing `--hh-*` tokens (`packages/ui/src/styles.css`). No new colours.

## Verified facts this plan relies on

| Fact | Where |
|---|---|
| `claude -p --setting-sources project --add-dir <dir>` reads files in `<dir>` and does not load that folder's `CLAUDE.md` | Spec §7, spike S1 |
| Codex's read-only sandbox reads outside its working folder; ACP needs no extra directories | Spec §7, spike S2 |
| The first `claude -p` run already reports `cache_read_input_tokens` (stable prefix cached) | Spec §7, spike S4 |
| `@agentclientprotocol/codex-acp@2.2.2` advertises `agentCapabilities.sessionCapabilities.close: {}` and implements `session/close` (`closeSession` unsubscribes the thread) | `node_modules/.pnpm/@agentclientprotocol+codex-acp@2.2.2/.../dist/index.js` |
| `@agentclientprotocol/sdk@1.8.0` has `session/close` (`CloseSessionRequest = { sessionId }`) and `SessionCapabilities.close` | `.../sdk/dist/acp.d.ts`, `schema/types.gen.d.ts` |
| Claude permission rules take absolute paths as `//abs/path/**` | Claude Code permission rule syntax |
| `acceptEdits` auto-accepts edits in every working directory, `--add-dir` ones included, so reference folders need deny rules | Claude Code permission modes |
| `@playwright/test` 1.63.0 was released 2026-09-04 and exports `_electron` | `npm view @playwright/test time` |

## Scope decisions

- **Actions are tasks.** `prompt` is required on every action (a file in the harness folder, checked by `loadHarness` with `resolveInHarness`); `description` is optional. `path` is optional and must name existing actions, each once. A harness with at least one action runs the work screen in **flow mode**; a harness without actions keeps the plain chat.
- **Core blocks** live in `harness-sdk` (`CORE_BLOCKS`): `choices` (visible, tool `show_choices`) and `save_note` (hidden, tool `save_note` through a new optional `Block.tool`). Their names are reserved. `allBlocks(harness)` is what the `ui` MCP server, the managed `AGENTS.md` section and the shell use.
- **One engine session per task.** The runtime starts with a fresh session unless given one (`RuntimeOptions.session`, used only by the dev CLI) and reports started sessions through `onSession`; `HarnessRuntime.endSession()` ends it (Claude: a new `--session-id` next turn; Codex: `session/close` when advertised, then `session/new`). `.harness/session.json` is no longer written by the app (the engine-switch check still reads it for folders from plan 2b).
- **Task state machine** (`packages/shell/src/main/task-manager.ts`, state in `.harness/tasks.json`): idle → running → waiting; a typed message while waiting is a follow-up in the same session; a `choices` pick with `next` or `action`, or a topic picked anywhere, closes the current task with one **quiet** closing turn (no chat entry, no window events, usage recorded with `phase: "close"`) and then starts the next one. Outcomes per action: `done` (a valid note was saved), `unsaved` (the closing turn brought none), `unfinished` (cancel, a failed first turn, engine switch, quit, dropped runtime). A task left open by a previous run of the app is marked unfinished at startup. A note saved during a normal turn makes the closing turn unnecessary.
- **Notes** are written by the app, never by the agent: `<folder>/.harness/notes/<action>.md` for actions, `q-<slug>.md` for free questions (atomic write, JSON-quoted front matter values so titles with colons stay valid YAML). The history tracks `.harness/notes/` (it still ignores the rest of `.harness/`), and the app records a commit "Note: <title>" after writing one, which makes the spec's "the history commit covers the folder" true.
- **Notes index:** newest first, about 1,500 tokens estimated as characters / 4; past the budget the oldest notes collapse to title + path, and if that is still too long the oldest are dropped with a "… N older notes" line. It is added where the brief says `{{notesIndex}}`, or appended when the brief has no placeholder. `{{language}}` becomes "Spanish" / "English".
- **Free questions** (typed while idle, or an FAQ chip) are tasks without an action, started from a core prompt with the question and the index. "Retomar este tema" on a free-question note asks to pick that topic up again.
- **Reference folders:** `folder.references[].default` is `"app-source"` (the repository the app runs from, found by walking up from the harness folder to `pnpm-workspace.yaml`; development only), an absolute path or a `~/` path. The managed `AGENTS.md` section lists them as read only (stable per machine). Claude gets `--add-dir` plus `Edit/Write/MultiEdit(//<dir>/**)` deny rules; Codex's permission answers allow reads there and never edits.
- **Opening files** ("Abrir", "Abrir el archivo") goes through `hh:openPath`: the path must resolve (symlinks included) to a regular file inside a reference folder or the user's folder, with a text, data or image extension (never `.app`, `.command`, scripts or installers), then `shell.openPath`.
- **Work screen (flow mode):** left `FlowSide` ("Recorrido" with done / current / pending steps, "Lo que ya quedó claro" notes list, reference folder with the "Solo lectura" lock); `StartView` while no task is on screen (topic cards from the actions in path order with "Visto" / "Sigue en el recorrido" / "Sin terminar" / "Sin resumen" badges, FAQ chips, composer hint); the chat shows only the current task's entries; `ChoicesBlock` drives the state machine through `client.choose`; `NotesPanel` with "Retomar este tema" and "Abrir el archivo". The harness supplies the start view's title, intro, FAQ and hint as keys of its own locales (`HarnessApp` prop `startView`). The panel shows the neutral sentence "starts from your summaries instead of re-reading the code", never a token figure.
- **Copy we chose where the mockups are demo-specific:** the core's lock line reads "Solo lectura: la IA no cambia nada acá" (the mockup's "no cambia tu código" only fits the demo); the mockup's "Resúmenes / Conversaciones" tabs in the notes panel are not built (archived conversations are out of scope); relative dates ("hoy", "ayer") are shown as locale short dates.
- **Demo:** the architecture explainer (`permissions: { edit: "none", exec: false, web: false }`), actions `manifest`, `engines`, `turn`, `blocks`, `context`, `history` in that path order, demo blocks `diagram` and `files`, curated `docs/architecture/<action>.md`. The `note`/`progress` blocks and the `tidy` action are removed. The core tests stop depending on the demo: they use a fixture harness in `packages/fake-agent/fixtures/notes-harness/` (Task 1).
- **E2E:** `packages/e2e` with Playwright, launching the electron-vite build of the shell with the fake agents through development-only test hooks (`HH_TEST_USER_DATA`, `HH_TEST_SHARED_DIR`, `HH_TEST_ENGINES`). Test folders live in `packages/e2e/.tmp/` (inside the repository, under the user's home), because the app refuses folders under `/var` and `/private`, where the system temp folder is on macOS.
- **Out of scope:** inspector panel, harness creator, plan tiers, history undo panel, editing notes in the UI, any specific harness, CI for the E2E tests (Linux CI needs `xvfb-run`; noted in the e2e README).

## File map

```
packages/fake-agent/
  package.json                                   (Task 1: harness-sdk, zod)
  fixtures/notes-harness/{harness.config.ts, agent/AGENTS.md, agent/seed/README.md}   (Task 1)
  src/script.ts, src/fake-claude.ts, src/fake-acp.ts                                    (Task 7)
packages/harness-sdk/src/block.ts, core-blocks.ts, index.ts                             (Tasks 2–3)
packages/blocks/src/ui-server.ts                                                        (Task 2)
packages/workspace/src/instructions.ts                                                  (Task 4)
packages/workspace/src/notes.ts, history.ts, index.ts                                   (Task 5)
packages/workspace/src/notes-index.ts                                                   (Task 6)
packages/runtime/src/transport.ts, claude-cli.ts, acp.ts                                (Tasks 8–9)
packages/runtime/src/runtime.ts, dev.ts                                                 (Task 10)
packages/shell/src/main/
  usage-log.ts, turn-controller.ts                                                      (Task 11)
  task-store.ts, engine-switch.ts                                                       (Task 13)
  task-prompts.ts                                                                       (Task 14)
  task-manager.ts                                                                       (Task 15)
  references.ts, open-path.ts, test-hooks.ts                                            (Task 16)
  index.ts                                                                              (Tasks 11, 17)
packages/shell/src/preload/index.ts                                                     (Task 12)
packages/ui/src/client.ts, test/fake-client.ts                                          (Task 12)
packages/i18n/src/locales/{es,en}.json, packages/ui/src/chrome.tsx                      (Task 18)
packages/ui/src/ChoicesBlock.tsx, FlowSide.tsx, StartView.tsx                           (Task 19)
packages/ui/src/NotesPanel.tsx                                                          (Task 20)
packages/ui/src/Message.tsx, ChatView.tsx, HarnessApp.tsx, index.ts, styles.css         (Task 21)
docs/architecture/{manifest,engines,turn,blocks,context,history}.md                     (Task 22)
harnesses/demo/** , vitest.config.ts, tsconfig.json, README.md                          (Task 23)
packages/e2e/{package.json, playwright.config.ts, README.md, tests/*.ts}, package.json, .gitignore   (Task 24)
```

---

## Phase 1 — SDK

### Task 1: A fixture harness for the core tests

The core tests load `harnesses/demo`, which Task 23 turns into the explainer. They move to a fixture with the same blocks the demo has today, so the demo can change freely.

**Files:**
- Create: `packages/fake-agent/fixtures/notes-harness/harness.config.ts`, `packages/fake-agent/fixtures/notes-harness/agent/AGENTS.md`, `packages/fake-agent/fixtures/notes-harness/agent/seed/README.md`
- Modify: `packages/fake-agent/package.json`, `tsconfig.json`
- Modify: `packages/harness-sdk/test/harness.test.ts`, `packages/blocks/test/ui-server.test.ts`, `packages/runtime/test/runtime.test.ts`

- [ ] **Step 1: Create the fixture**

`packages/fake-agent/fixtures/notes-harness/harness.config.ts`:
```ts
// Test fixture for the core packages: the smallest harness with one visible and one state-only block.
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
  id: "notes",
  name: { es: "Notas", en: "Notes" },
  core: "^0.1.0",
  languages: ["es", "en"],
  engines: ["claude", "codex"],
  folder: { suggested: "Documents/Human Harness Notes", seed: "./agent/seed" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "folder", exec: false, web: false },
  blocks: { note, progress },
  author: "Human Harness tests",
});
```

`packages/fake-agent/fixtures/notes-harness/agent/AGENTS.md`:
```md
# Notes

You are a test assistant for Human Harness.

- When the person asks for a note, call the `show_note` tool and also save it as `notes/<title>.md`.
- After every answer, call `update_progress` with how far along the conversation is (0 to 100).
```

`packages/fake-agent/fixtures/notes-harness/agent/seed/README.md`:
```md
This folder is used by the Human Harness test harness.
```

In `packages/fake-agent/package.json`, replace the `dependencies` block with:
```json
  "dependencies": {
    "@agentclientprotocol/sdk": "^1.8.0",
    "@humanharness/harness-sdk": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.32.1",
    "tsx": "^4.23.15",
    "zod": "^4.6.5"
  }
```

In `tsconfig.json`, replace the `include` line with:
```json
  "include": ["packages/*/src", "packages/*/test", "packages/fake-agent/fixtures", "harnesses/*/*.ts", "harnesses/*/ui"]
```

Run: `corepack pnpm install`
Expected: the lockfile gains the two workspace links for `@humanharness/fake-agent`; no new downloads.

- [ ] **Step 2: Point the tests at the fixture**

In `packages/harness-sdk/test/harness.test.ts`, replace the `DEMO` constant with:
```ts
const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/notes-harness/harness.config.ts");
```
and replace the whole `describe("loadHarness", …)` and `describe("resolveInHarness", …)` blocks with:
```ts
describe("loadHarness", () => {
  it("loads a manifest and records its root", async () => {
    const h = await loadHarness(FIXTURE);
    expect(h.id).toBe("notes");
    expect(h.root).toBe(path.dirname(FIXTURE));
    expect(h.configPath).toBe(FIXTURE);
    expect(resolveInHarness(h, h.instructions)).toBe(path.join(path.dirname(FIXTURE), "agent/AGENTS.md"));
    expect(Object.keys(h.blocks)).toEqual(["note", "progress"]);
  });

  it("throws when the module has no default export", async () => {
    const dir = fs.mkdtempSync(path.join(root, "t-"));
    const file = path.join(dir, "harness.config.ts");
    fs.writeFileSync(file, "export const x = 1;");
    await expect(loadHarness(file)).rejects.toThrow(`${file} has no default export`);
  });

  it("accepts a root override for compiled manifests", async () => {
    const h = await loadHarness(FIXTURE, { root: "/somewhere/else" });
    expect(h.root).toBe("/somewhere/else");
    expect(h.configPath).toBe(FIXTURE);
  });
});

describe("resolveInHarness", () => {
  it("rejects paths that escape the harness folder", async () => {
    const h = await loadHarness(FIXTURE);
    expect(() => resolveInHarness(h, "../../etc/passwd")).toThrow("Path escapes the harness folder: ../../etc/passwd");
  });
});
```

In `packages/blocks/test/ui-server.test.ts`, replace the `DEMO` constant with:
```ts
const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/notes-harness/harness.config.ts");
```
and in `connect`, replace `harnessConfig: DEMO` with `harnessConfig: FIXTURE`.

In `packages/runtime/test/runtime.test.ts`, replace the `DEMO` constant with:
```ts
const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/notes-harness/harness.config.ts");
```
replace both `harness: await loadHarness(DEMO),` lines with `harness: await loadHarness(FIXTURE),`, and in the test "prepares the folder: seed, AGENTS.md with managed section, CLAUDE.md" replace
```ts
    expect(fs.readFileSync(path.join(folder, "README.md"), "utf8")).toContain("demo app");
```
with
```ts
    expect(fs.readFileSync(path.join(folder, "README.md"), "utf8")).toContain("test harness");
```
and in the tests "rolls back the folder when the agent crashes mid-turn" and "commits user edits between turns and keeps them when the next turn crashes" replace `.toContain("demo app")` with `.toContain("test harness")` (one line each).

- [ ] **Step 3: Run the tests**

Run: `corepack pnpm vitest run packages/harness-sdk packages/blocks packages/runtime`
Expected: PASS (same tests, now against the fixture).

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/fake-agent tsconfig.json pnpm-lock.yaml packages/harness-sdk/test packages/blocks/test packages/runtime/test
git commit -m "test: run the core tests against a fixture harness instead of the demo"
```

### Task 2: Core blocks `choices` and `save_note`

**Files:**
- Create: `packages/harness-sdk/src/block.ts`, `packages/harness-sdk/src/core-blocks.ts`
- Modify: `packages/harness-sdk/src/index.ts`, `packages/blocks/src/ui-server.ts`
- Test: `packages/harness-sdk/test/harness.test.ts`, `packages/blocks/test/ui-server.test.ts`

- [ ] **Step 1: Failing tests**

In `packages/harness-sdk/test/harness.test.ts`, change the import from `"../src"` to:
```ts
import { CORE_BLOCKS, allBlocks, blockToolName, choicesSchema, defineBlock, defineHarness, loadHarness, resolveInHarness, saveNoteSchema } from "../src";
```
and append:
```ts
describe("core blocks", () => {
  it("offers choices (visible, show_choices) and save_note (hidden, its own tool name)", () => {
    expect(blockToolName("choices", CORE_BLOCKS.choices)).toBe("show_choices");
    expect(blockToolName("save_note", CORE_BLOCKS.save_note)).toBe("save_note");
    expect(CORE_BLOCKS.choices.visible).toBe(true);
    expect(CORE_BLOCKS.save_note.visible).toBe(false);
  });

  it("validates choice options and notes", () => {
    expect(choicesSchema.safeParse({ options: [{ label: "Next topic", next: true }] }).success).toBe(true);
    expect(choicesSchema.safeParse({ options: [{ label: "Deeper", followUp: "Tell me more", action: "turn" }] }).success).toBe(true);
    expect(choicesSchema.safeParse({ options: [] }).success).toBe(false);
    expect(choicesSchema.safeParse({ options: [{ label: "x", next: false }] }).success).toBe(false);
    const note = { title: "T", summary: ["a"], decisions: [], files: [], open: [] };
    expect(saveNoteSchema.safeParse(note).success).toBe(true);
    expect(saveNoteSchema.safeParse({ ...note, summary: ["a", "b", "c", "d", "e", "f"] }).success).toBe(false);
    expect(saveNoteSchema.safeParse({ ...note, summary: [] }).success).toBe(false);
    expect(saveNoteSchema.safeParse({ ...note, title: "" }).success).toBe(false);
  });

  it("adds the core blocks to the harness's and reserves their names", () => {
    const h = defineHarness({ ...base, languages: [...base.languages] });
    expect(Object.keys(allBlocks(h))).toEqual(["choices", "save_note", "note"]);
    expect(() => defineHarness({ ...base, languages: [...base.languages], blocks: { choices: block } })).toThrow(/core block/);
    expect(() => defineHarness({ ...base, languages: [...base.languages], blocks: { save_note: block } })).toThrow(/core block/);
  });
});
```

In `packages/blocks/test/ui-server.test.ts`, replace the test "exposes one tool per block" with:
```ts
  it("exposes one tool per block, the core blocks included", async () => {
    const c = await connect([]);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["save_note", "show_choices", "show_note", "update_progress"]);
    expect(tools.find((t) => t.name === "show_note")?.description).toContain("note");
  });

  it("forwards a save_note call under the block's name", async () => {
    const received: BlockMessage[] = [];
    const c = await connect(received);
    const note = { title: "T", summary: ["a"], decisions: [], files: [], open: [] };
    const result = await c.callTool({ name: "save_note", arguments: note });
    expect(result.isError).toBeFalsy();
    expect(received).toEqual([{ name: "save_note", data: note }]);
  });
```

Run: `corepack pnpm vitest run packages/harness-sdk packages/blocks`
Expected: FAIL (`CORE_BLOCKS`, `allBlocks`, `choicesSchema`, `saveNoteSchema` don't exist; the server lists two tools).

- [ ] **Step 2: Move `Block` into its own module**

Create `packages/harness-sdk/src/block.ts`:
```ts
import type { z } from "zod";

/** A piece of UI the agent can show (visible) or update (state-only) through an MCP tool. */
export interface Block<S extends z.ZodObject = z.ZodObject> {
  description: string;
  visible: boolean;
  schema: S;
  example: z.infer<S>;
  /** The MCP tool's name. Default: `show_<name>` for visible blocks, `update_<name>` for state-only ones. */
  tool?: string;
}

export function defineBlock<S extends z.ZodObject>(block: Block<S>): Block<S> {
  const result = block.schema.safeParse(block.example);
  if (!result.success) throw new Error(`The block example does not match its schema: ${result.error.message}`);
  return block;
}

/** Name of the MCP tool the agent calls for a block. */
export function blockToolName(name: string, block: Pick<Block, "visible" | "tool">): string {
  return block.tool ?? `${block.visible ? "show" : "update"}_${name}`;
}
```

Create `packages/harness-sdk/src/core-blocks.ts`:
```ts
import { z } from "zod";
import { type Block, defineBlock } from "./block";

/** One way to continue: `followUp` stays on the topic, `action` starts another task, `next: true` follows the guided path. */
export const choiceOptionSchema = z.object({
  label: z.string().min(1).max(160),
  followUp: z.string().min(1).max(2000).optional(),
  action: z.string().regex(/^[a-z][a-z0-9_-]*$/).optional(),
  next: z.literal(true).optional(),
});
export type ChoiceOption = z.infer<typeof choiceOptionSchema>;

export const choicesSchema = z.object({ options: z.array(choiceOptionSchema).min(1).max(4) });

/** What a task made clear. The app validates it and writes it to `.harness/notes/`. */
export const saveNoteSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.array(z.string().min(1).max(400)).min(1).max(5),
  decisions: z.array(z.string().min(1).max(400)).max(10),
  files: z.array(z.string().min(1).max(300)).max(20),
  open: z.array(z.string().min(1).max(400)).max(10),
});
export type SavedNote = z.infer<typeof saveNoteSchema>;

/** Blocks every harness has. Their names are reserved. */
export const CORE_BLOCKS = {
  choices: defineBlock({
    description:
      "Ends every answer: offers the person 2 to 4 ways to continue. `label` is what the person reads. An option with `followUp` stays on this topic (the app sends that text as the person's next message); `action` starts another topic by its id; `next: true` moves on to the next topic of the guided path.",
    visible: true,
    schema: choicesSchema,
    example: {
      options: [
        { label: "Go deeper: what happens when a turn is cancelled", followUp: "Explain what happens when the person cancels a turn halfway." },
        { label: "Next topic →", next: true },
      ],
    },
  }),
  save_note: defineBlock({
    description:
      "Saves what this topic made clear, only when the app asks you to close the topic. The app writes the note into the folder: never write it yourself. `summary`: at most 5 short key points; `decisions`: what was settled; `files`: paths that back the summary; `open`: questions left open.",
    visible: false,
    tool: "save_note",
    schema: saveNoteSchema,
    example: {
      title: "A turn end to end",
      summary: ["ui → shell → runtime → engine CLI; events come back"],
      decisions: [],
      files: ["packages/runtime/src/runtime.ts"],
      open: [],
    },
  }),
} satisfies Record<string, Block>;

export const CORE_BLOCK_NAMES: readonly string[] = Object.keys(CORE_BLOCKS);

/** The core blocks plus the harness's own: what the agent gets as tools. */
export function allBlocks(harness: { blocks: Record<string, Block> }): Record<string, Block> {
  return { ...CORE_BLOCKS, ...harness.blocks };
}
```

In `packages/harness-sdk/src/index.ts`, delete lines 9–26 (the `Block` interface, `defineBlock` and `blockToolName`; they now live in `block.ts`), add after the `import { z } from "zod";` line:
```ts
import { type Block } from "./block";
import { CORE_BLOCK_NAMES } from "./core-blocks";

export * from "./block";
export * from "./core-blocks";
```
and replace the `manifestSchema` declaration's closing `});` (the line after `donate: z.url().optional(),`) with:
```ts
}).superRefine((m, ctx) => {
  for (const name of Object.keys(m.blocks)) {
    if (CORE_BLOCK_NAMES.includes(name)) ctx.addIssue({ code: "custom", path: ["blocks", name], message: `"${name}" is a core block name` });
  }
});
```

- [ ] **Step 3: Serve the core blocks from the `ui` MCP server**

In `packages/blocks/src/ui-server.ts`, replace the import of `@humanharness/harness-sdk` with:
```ts
import { allBlocks, blockToolName, loadHarness } from "@humanharness/harness-sdk";
```
and replace `for (const [name, block] of Object.entries(harness.blocks)) {` with:
```ts
  for (const [name, block] of Object.entries(allBlocks(harness))) {
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/harness-sdk packages/blocks packages/workspace packages/runtime`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/harness-sdk packages/blocks
git commit -m "feat(sdk): core blocks choices and save_note"
```

### Task 3: Manifest — action prompts, guided path, reference folders

**Files:**
- Modify: `packages/harness-sdk/src/index.ts`
- Modify: `harnesses/demo/harness.config.ts`; Create: `harnesses/demo/agent/tasks/tidy.md` (removed again in Task 23)
- Test: `packages/harness-sdk/test/harness.test.ts`

- [ ] **Step 1: Failing tests**

In `packages/harness-sdk/test/harness.test.ts`, replace the test "declares actions with a cost hint, empty by default" with:
```ts
  it("declares actions with a prompt and a cost hint, empty by default", () => {
    expect(defineHarness({ ...base, languages: [...base.languages] }).actions).toEqual({});
    const research = { label: { es: "Investigar", en: "Research" }, prompt: "./agent/tasks/research.md", cost: "heavy" as const };
    const h = defineHarness({ ...base, languages: [...base.languages], actions: { research } });
    expect(h.actions.research).toEqual(research);
    expect(() =>
      defineHarness({ ...base, languages: [...base.languages], actions: { research: { ...research, cost: "huge" as never } } }),
    ).toThrow();
    expect(() => defineHarness({ ...base, languages: [...base.languages], actions: { "Bad Name": research } })).toThrow();
    expect(() =>
      defineHarness({ ...base, languages: [...base.languages], actions: { research: { label: research.label, cost: "light" } as never } }),
    ).toThrow();
  });

  it("orders actions in an optional guided path", () => {
    const actions = {
      turn: { label: { es: "Un turno", en: "A turn" }, description: { es: "De punta a punta", en: "End to end" }, prompt: "./agent/tasks/turn.md", cost: "medium" as const },
      blocks: { label: { es: "Bloques", en: "Blocks" }, prompt: "./agent/tasks/blocks.md", cost: "light" as const },
    };
    const h = defineHarness({ ...base, languages: [...base.languages], actions, path: ["turn", "blocks"] });
    expect(h.path).toEqual(["turn", "blocks"]);
    expect(h.actions.turn.description).toEqual({ es: "De punta a punta", en: "End to end" });
    expect(defineHarness({ ...base, languages: [...base.languages], actions }).path).toBeUndefined();
    expect(() => defineHarness({ ...base, languages: [...base.languages], actions, path: ["turn", "nope"] })).toThrow(/nope/);
    expect(() => defineHarness({ ...base, languages: [...base.languages], actions, path: ["turn", "turn"] })).toThrow(/twice/);
  });

  it("declares read-only reference folders", () => {
    const ref = (d: string, id = "source") => ({ id, label: { es: "Código", en: "Source" }, default: d });
    const withRefs = (references: ReturnType<typeof ref>[]) =>
      defineHarness({ ...base, languages: [...base.languages], folder: { suggested: "Documents/Test", references } });
    expect(withRefs([ref("app-source")]).folder.references).toEqual([ref("app-source")]);
    expect(defineHarness({ ...base, languages: [...base.languages] }).folder.references).toEqual([]);
    expect(() => withRefs([ref("~/code/x"), ref("/opt/x", "other")])).not.toThrow();
    expect(() => withRefs([ref("relative/x")])).toThrow(/app-source/);
    expect(() => withRefs([ref("app-source"), ref("/opt/x")])).toThrow(/twice/);
  });
```
and append inside `describe("loadHarness")`:
```ts
  it("rejects action prompts outside the harness folder", async () => {
    const dir = fs.mkdtempSync(path.join(root, "t-"));
    const file = path.join(dir, "harness.config.mjs");
    const manifest = {
      id: "x",
      name: { es: "X", en: "X" },
      core: "^0.1.0",
      languages: ["es"],
      engines: ["claude"],
      folder: { suggested: "Documents/X" },
      instructions: "./AGENTS.md",
      permissions: { edit: "none", exec: false, web: false },
      blocks: {},
      actions: { a: { label: { es: "A", en: "A" }, prompt: "../../outside.md", cost: "light" } },
      author: "x",
    };
    fs.writeFileSync(file, `export default ${JSON.stringify(manifest)};`);
    await expect(loadHarness(file)).rejects.toThrow("Path escapes the harness folder: ../../outside.md");
  });
```

Run: `corepack pnpm vitest run packages/harness-sdk`
Expected: FAIL (`prompt`, `description`, `path` and `references` are unknown; prompts aren't checked).

- [ ] **Step 2: Implement**

In `packages/harness-sdk/src/index.ts`, replace the `actionSchema` declaration (its doc comment included) with:
```ts
/**
 * A task the harness can start (a topic card, a step of the guided path, a button): its brief is the first
 * message of the task's engine session. `cost` is how much of the plan it tends to use.
 */
const actionSchema = z.object({
  label: localizedText,
  /** One line under the label on the topic card. */
  description: localizedText.optional(),
  /** The task brief: a file in the harness folder. It may use {{language}} and {{notesIndex}}. */
  prompt: z.string().min(1),
  cost: z.enum(ACTION_COSTS),
});
/** A folder the agent may read but never change. */
const referenceSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: localizedText,
  /** "app-source" (the repository the app runs from, in development), an absolute path or a "~/" path. */
  default: z
    .string()
    .min(1)
    .refine((d) => d === "app-source" || d.startsWith("/") || d.startsWith("~/"), {
      message: 'Use "app-source", an absolute path or a path starting with ~/',
    }),
});
```
replace the `folder` line of `manifestSchema` with:
```ts
  folder: z.object({ suggested: z.string().min(1), seed: z.string().optional(), references: z.array(referenceSchema).default([]) }),
```
add after the `actions` line:
```ts
  /** Optional guided order of action ids (the "Recorrido"). */
  path: z.array(z.string()).optional(),
```
replace the `superRefine` added in Task 2 with:
```ts
}).superRefine((m, ctx) => {
  for (const name of Object.keys(m.blocks)) {
    if (CORE_BLOCK_NAMES.includes(name)) ctx.addIssue({ code: "custom", path: ["blocks", name], message: `"${name}" is a core block name` });
  }
  const seen = new Set<string>();
  for (const id of m.path ?? []) {
    if (!Object.hasOwn(m.actions, id)) ctx.addIssue({ code: "custom", path: ["path"], message: `Unknown action in path: "${id}"` });
    if (seen.has(id)) ctx.addIssue({ code: "custom", path: ["path"], message: `"${id}" is in the path twice` });
    seen.add(id);
  }
  const refs = new Set<string>();
  for (const r of m.folder.references) {
    if (refs.has(r.id)) ctx.addIssue({ code: "custom", path: ["folder", "references"], message: `Reference "${r.id}" is declared twice` });
    refs.add(r.id);
  }
});
```
add after `export type Permissions = Harness["permissions"];`:
```ts
export type HarnessReference = Harness["folder"]["references"][number];
```
and replace the body of `loadHarness` after the `mod.default` check with:
```ts
  const harness = manifestSchema.parse(mod.default);
  const loaded: LoadedHarness = { ...harness, root: options.root ? path.resolve(options.root) : path.dirname(absolute), configPath: absolute };
  // Every task brief must live inside the harness folder.
  for (const action of Object.values(loaded.actions)) resolveInHarness(loaded, action.prompt);
  return loaded;
```

- [ ] **Step 3: Keep the demo valid**

In `harnesses/demo/harness.config.ts`, replace the `tidy` line with:
```ts
    tidy: { label: { es: "Ordenar mis notas", en: "Tidy up my notes" }, prompt: "./agent/tasks/tidy.md", cost: "heavy" },
```
Create `harnesses/demo/agent/tasks/tidy.md`:
```md
Review all my notes, merge duplicates and give each one a clear title.

{{notesIndex}}
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/harness-sdk`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/harness-sdk harnesses/demo
git commit -m "feat(sdk): action prompts, guided path and reference folders in the manifest"
```

---

## Phase 2 — Workspace

### Task 4: Managed section — core blocks and reference folders

**Files:**
- Modify: `packages/workspace/src/instructions.ts`
- Test: `packages/workspace/test/instructions.test.ts`

- [ ] **Step 1: Failing tests**

In `packages/workspace/test/instructions.test.ts`, change the harness-sdk import to:
```ts
import { CORE_BLOCKS, defineBlock } from "@humanharness/harness-sdk";
```
and append inside `describe("managedSection")`:
```ts
  it("documents the core blocks with their own tool names", () => {
    const s = managedSection({ language: "en", blocks: { ...CORE_BLOCKS, ...blocks } });
    expect(s).toContain("`show_choices`");
    expect(s).toContain("`save_note`");
    expect(s).not.toContain("update_save_note");
  });

  it("lists the reference folders as read only, and only when there are some", () => {
    const s = managedSection({ language: "es", blocks, references: [{ label: "Código de Human Harness", path: "/Users/me/code/hh" }] });
    expect(s).toContain("### Carpetas de referencia (solo lectura)");
    expect(s).toContain("Podés leer estas carpetas con tus herramientas de lectura. Nunca cambies nada en ellas.");
    expect(s).toContain("- Código de Human Harness: `/Users/me/code/hh`");
    expect(s.indexOf("Carpetas de referencia")).toBeLessThan(s.indexOf(MANAGED_END));
    expect(managedSection({ language: "en", blocks })).not.toContain("Reference folders");
    expect(managedSection({ language: "en", blocks, references: [{ label: "Source", path: "/r" }] })).toContain("### Reference folders (read only)");
  });
```
and append inside `describe("writeInstructions")`:
```ts
  it("writes the reference folders into AGENTS.md", async () => {
    const folder = tmp();
    await writeInstructions({ folder, base: "x", language: "en", blocks, references: [{ label: "Source", path: "/r" }], engine: getEngine("codex") });
    expect(fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8")).toContain("- Source: `/r`");
  });
```

Run: `corepack pnpm vitest run packages/workspace`
Expected: FAIL (no reference section; `references` is not an option).

- [ ] **Step 2: Implement**

In `packages/workspace/src/instructions.ts`, replace the `TEXT` declaration's type and add the two new strings per language. The whole declaration becomes:
```ts
const TEXT: Record<
  Language,
  { title: string; rules: string[]; tools: string; toolsIntro: string; example: string; schema: string; references: string; referencesIntro: string }
> = {
  es: {
    title: "## Entorno (lo genera Human Harness; no editar)",
    rules: [
      "Respondé siempre en español.",
      "Estás dentro de una app de escritorio: la persona te habla desde una interfaz, no desde una terminal. No le muestres comandos ni rutas de archivos salvo que te las pida.",
      "No uses preguntas interactivas propias de tu CLI: preguntá con texto o con las herramientas de interfaz de abajo.",
      "Trabajá solo dentro de esta carpeta. Mensajes cortos y claros.",
    ],
    tools: "### Herramientas de interfaz",
    toolsIntro: "Llamá estas herramientas para mostrarle cosas a la persona o actualizar su estado.",
    example: "Ejemplo",
    schema: "Schema",
    references: "### Carpetas de referencia (solo lectura)",
    referencesIntro: "Podés leer estas carpetas con tus herramientas de lectura. Nunca cambies nada en ellas.",
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
    toolsIntro: "Call these tools to show things to the person or update their state.",
    example: "Example",
    schema: "Schema",
    references: "### Reference folders (read only)",
    referencesIntro: "You may read these folders with your read tools. Never change anything in them.",
  },
};

/** A folder the agent may read but never change, with the label the instructions show. */
export interface ReferenceFolder {
  label: string;
  path: string;
}
```
Replace `managedSection` with:
```ts
export function managedSection(opts: { language: Language; blocks: Record<string, Block>; references?: ReferenceFolder[] }): string {
  const t = TEXT[opts.language];
  const lines = [MANAGED_START, t.title, "", ...t.rules.map((r) => `- ${r}`)];
  const entries = Object.entries(opts.blocks);
  if (entries.length > 0) {
    lines.push("", t.tools, "", t.toolsIntro, "");
    for (const [name, block] of entries) {
      lines.push(
        `- \`${blockToolName(name, block)}\`: ${block.description}`,
        `  ${t.example}: \`${JSON.stringify(block.example)}\``,
        `  ${t.schema}: \`${toolSchema(block.schema)}\``,
      );
    }
  }
  const references = opts.references ?? [];
  if (references.length > 0) {
    lines.push("", t.references, "", t.referencesIntro, "");
    for (const r of references) lines.push(`- ${r.label}: \`${r.path}\``);
  }
  lines.push(MANAGED_END, "");
  return lines.join("\n");
}
```
In `writeInstructions`, add `references?: ReferenceFolder[];` to its options type (after `blocks`), and replace the `agents` line with:
```ts
  const agents = `${opts.base.trimEnd()}\n\n${managedSection({ language: opts.language, blocks: opts.blocks, references: opts.references })}`;
```

- [ ] **Step 3: Run the tests**

Run: `corepack pnpm vitest run packages/workspace`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/workspace
git commit -m "feat(workspace): list core blocks and read-only reference folders in AGENTS.md"
```

### Task 5: Notes store, tracked by the history

**Files:**
- Create: `packages/workspace/src/notes.ts`, `packages/workspace/test/notes.test.ts`
- Modify: `packages/workspace/src/history.ts`, `packages/workspace/src/index.ts`
- Test: `packages/workspace/test/history.test.ts`

- [ ] **Step 1: Failing tests**

Create `packages/workspace/test/notes.test.ts`:
```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { noteSlug, parseNote, readNotes, renderNote, writeNote } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const tmp = () => fs.mkdtempSync(path.join(root, "t-"));

const note = {
  title: "A turn: end to end",
  summary: ["ui → shell → runtime", "events come back"],
  decisions: ["One session per task"],
  files: ["packages/runtime/src/runtime.ts"],
  open: [],
};
const meta = { action: "turn", date: "2026-10-12T11:20:00.000Z", engine: "claude" };

describe("writeNote", () => {
  it("writes front matter and sections, and reads them back", async () => {
    const folder = tmp();
    expect(await writeNote(folder, "turn", note, meta)).toBe(".harness/notes/turn.md");
    expect(fs.readFileSync(path.join(folder, ".harness/notes/turn.md"), "utf8")).toBe(
      [
        "---",
        'title: "A turn: end to end"',
        'action: "turn"',
        'date: "2026-10-12T11:20:00.000Z"',
        'engine: "claude"',
        'files: ["packages/runtime/src/runtime.ts"]',
        "---",
        "## Summary",
        "- ui → shell → runtime",
        "- events come back",
        "",
        "## Decisions",
        "- One session per task",
        "",
      ].join("\n"),
    );
    expect(await readNotes(folder)).toEqual([{ slug: "turn", path: ".harness/notes/turn.md", ...note, ...meta }]);
  });

  it("keeps each point on one line and writes the open questions", () => {
    const parsed = parseNote("x", renderNote({ ...note, summary: ["two\n  lines"], open: ["Who reads the archive?"] }, { date: "d", engine: "e" }));
    expect(parsed?.summary).toEqual(["two lines"]);
    expect(parsed?.open).toEqual(["Who reads the archive?"]);
    expect(parsed?.action).toBeUndefined();
  });

  it("replaces a note without leaving temp files", async () => {
    const folder = tmp();
    await writeNote(folder, "q-chats", note, { date: "d", engine: "codex" });
    await writeNote(folder, "q-chats", { ...note, title: "Second" }, { date: "d", engine: "codex" });
    expect((await readNotes(folder)).map((n) => n.title)).toEqual(["Second"]);
    expect(fs.readdirSync(path.join(folder, ".harness/notes"))).toEqual(["q-chats.md"]);
  });

  it("refuses a slug that could leave the notes folder", async () => {
    await expect(writeNote(tmp(), "../evil", note, meta)).rejects.toThrow(/slug/);
    await expect(writeNote(tmp(), "", note, meta)).rejects.toThrow(/slug/);
  });
});

describe("readNotes", () => {
  it("lists notes newest first and skips files that are not notes", async () => {
    const folder = tmp();
    await writeNote(folder, "old", { ...note, title: "Old" }, { ...meta, date: "2026-10-10T10:00:00.000Z" });
    await writeNote(folder, "new", { ...note, title: "New" }, { ...meta, date: "2026-10-12T10:00:00.000Z" });
    fs.writeFileSync(path.join(folder, ".harness/notes/broken.md"), "no front matter");
    fs.writeFileSync(path.join(folder, ".harness/notes/readme.txt"), "x");
    expect((await readNotes(folder)).map((n) => n.title)).toEqual(["New", "Old"]);
  });

  it("is empty when there is no notes folder", async () => {
    expect(await readNotes(tmp())).toEqual([]);
  });
});

describe("noteSlug", () => {
  it("makes a file-safe slug", () => {
    expect(noteSlug("¿Dónde se guarda la conversación?")).toBe("donde-se-guarda-la-conversacion");
    expect(noteSlug("!!!")).toBe("note");
    expect(noteSlug("a".repeat(100))).toHaveLength(60);
  });
});
```

Append inside `describe("History")` in `packages/workspace/test/history.test.ts`:
```ts
  it("tracks the notes under .harness/ and nothing else there", async () => {
    const h = new History(folder, gitdir, [".harness/", "AGENTS.md"], [".harness/notes/"]);
    write(".harness/notes/turn.md", "note");
    write(".harness/chats/main.jsonl", "chat");
    write("mine.md", "mine");
    const sha = (await h.save("with a note"))!;
    fs.rmSync(path.join(folder, ".harness/notes/turn.md"));
    write(".harness/chats/main.jsonl", "changed");
    await h.restore(sha, "back");
    expect(read(".harness/notes/turn.md")).toBe("note");
    expect(read(".harness/chats/main.jsonl")).toBe("changed");
  });
```

Run: `corepack pnpm vitest run packages/workspace`
Expected: FAIL (`writeNote`, `readNotes`, `renderNote`, `noteSlug`, `parseNote` don't exist; `History` takes no `keep` list).

- [ ] **Step 2: Implement the notes store**

Create `packages/workspace/src/notes.ts`:
```ts
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SavedNote } from "@humanharness/harness-sdk";

/** Where notes live, relative to the folder (forward slashes, as the history and the index show it). */
export const NOTES_PREFIX = ".harness/notes/";

/** What the app adds to a note the agent saved. */
export interface NoteMeta {
  /** The manifest action of the task; absent for a free question. */
  action?: string;
  date: string;
  engine: string;
}

export interface Note extends SavedNote, NoteMeta {
  /** File name without `.md`. */
  slug: string;
  /** Path relative to the folder: `.harness/notes/<slug>.md`. */
  path: string;
}

const SLUG = /^[a-z0-9][a-z0-9_-]*$/;

/** A file-safe slug: lowercase ascii letters, digits and dashes, at most 60 characters; "note" when nothing is left. */
export function noteSlug(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || "note";
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, " ").trim();
const section = (title: string, items: string[]) => [`## ${title}`, ...items.map((i) => `- ${oneLine(i)}`)];

/** The note as Markdown: JSON-quoted front matter values (valid YAML), then Summary, Decisions and Open questions. */
export function renderNote(note: SavedNote, meta: NoteMeta): string {
  return [
    "---",
    `title: ${JSON.stringify(oneLine(note.title))}`,
    ...(meta.action ? [`action: ${JSON.stringify(meta.action)}`] : []),
    `date: ${JSON.stringify(meta.date)}`,
    `engine: ${JSON.stringify(meta.engine)}`,
    `files: ${JSON.stringify(note.files)}`,
    "---",
    ...section("Summary", note.summary),
    ...(note.decisions.length ? ["", ...section("Decisions", note.decisions)] : []),
    ...(note.open.length ? ["", ...section("Open questions", note.open)] : []),
    "",
  ].join("\n");
}

/** Writes `.harness/notes/<slug>.md` atomically (temp file + rename). Returns its path relative to the folder. */
export async function writeNote(folder: string, slug: string, note: SavedNote, meta: NoteMeta): Promise<string> {
  if (!SLUG.test(slug)) throw new Error(`Invalid note slug: "${slug}"`);
  const dir = path.join(folder, NOTES_PREFIX);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${slug}.md`);
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, renderNote(note, meta));
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return `${NOTES_PREFIX}${slug}.md`;
}

/** Reads a note file; null when it has no front matter or no title (e.g. the person broke it by hand). */
export function parseNote(slug: string, text: string): Note | null {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"));
  if (!m) return null;
  const front: Record<string, unknown> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const raw = line.slice(i + 1).trim();
    try {
      front[key] = JSON.parse(raw);
    } catch {
      front[key] = raw;
    }
  }
  const sections: Record<string, string[]> = {};
  let current: string | null = null;
  for (const line of m[2].split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = heading[1].toLowerCase();
      sections[current] = [];
      continue;
    }
    const item = /^\s*[-*]\s+(.+?)\s*$/.exec(line);
    if (current && item) sections[current].push(item[1]);
  }
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const title = str(front.title);
  if (!title) return null;
  const action = str(front.action);
  return {
    slug,
    path: `${NOTES_PREFIX}${slug}.md`,
    title,
    ...(action ? { action } : {}),
    date: str(front.date) ?? "",
    engine: str(front.engine) ?? "",
    files: Array.isArray(front.files) ? front.files.filter((f): f is string => typeof f === "string") : [],
    summary: sections.summary ?? [],
    decisions: sections.decisions ?? [],
    open: sections["open questions"] ?? [],
  };
}

/** Every readable note in the folder, newest first. */
export async function readNotes(folder: string): Promise<Note[]> {
  const dir = path.join(folder, NOTES_PREFIX);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  const notes: Note[] = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const slug = file.slice(0, -3);
    if (!SLUG.test(slug)) continue;
    const note = parseNote(slug, await fs.readFile(path.join(dir, file), "utf8").catch(() => ""));
    if (note) notes.push(note);
  }
  return notes.sort((a, b) => b.date.localeCompare(a.date));
}
```

In `packages/workspace/src/index.ts`, add:
```ts
export * from "./notes";
```

- [ ] **Step 3: Let the history track the notes**

In `packages/workspace/src/history.ts`, replace the constructor with:
```ts
  constructor(
    private readonly folder: string,
    private readonly gitdir: string,
    private readonly ignore: string[] = [".harness/"],
    /** Prefixes tracked even inside an ignored one (the notes under `.harness/`). */
    private readonly keep: string[] = [],
  ) {}
```
and the `tracked` arrow with:
```ts
  private tracked = (file: string): boolean =>
    !file.endsWith(".DS_Store") &&
    !file.endsWith(".tmp") &&
    (this.keep.some((k) => file.startsWith(k)) || !this.ignore.some((i) => (i.endsWith("/") ? file.startsWith(i) : file === i)));
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/workspace`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/workspace
git commit -m "feat(workspace): notes store in .harness/notes, tracked by the history"
```

### Task 6: Notes index

**Files:**
- Create: `packages/workspace/src/notes-index.ts`, `packages/workspace/test/notes-index.test.ts`
- Modify: `packages/workspace/src/index.ts`

- [ ] **Step 1: Failing tests**

Create `packages/workspace/test/notes-index.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { type Note, buildNotesIndex, estimateTokens } from "../src";

const note = (i: number, extra: Partial<Note> = {}): Note => ({
  slug: `n${i}`,
  path: `.harness/notes/n${i}.md`,
  title: `Topic ${i}`,
  action: `t${i}`,
  date: new Date(Date.UTC(2026, 9, 1) + i * 3_600_000).toISOString(),
  engine: "claude",
  summary: [`point ${i}a`, `point ${i}b`],
  decisions: [`decision ${i}`],
  files: [],
  open: [],
  ...extra,
});

describe("buildNotesIndex", () => {
  it("is empty without notes", () => {
    expect(buildNotesIndex([])).toBe("");
  });

  it("lists what was covered, newest first, then the decisions", () => {
    expect(buildNotesIndex([note(1), note(2, { action: undefined })])).toBe(
      [
        "## What we already covered",
        "- Topic 2: point 2a; point 2b → .harness/notes/n2.md",
        "- Topic 1 (t1): point 1a; point 1b → .harness/notes/n1.md",
        "",
        "## Decisions so far",
        "- decision 2",
        "- decision 1",
        "",
        "Open a note with your read tool when you need its details.",
      ].join("\n"),
    );
  });

  it("collapses the oldest notes to title and path to fit the budget", () => {
    const long = (i: number) => note(i, { summary: ["x".repeat(400)] });
    const index = buildNotesIndex([long(1), long(2), long(3)], { budgetTokens: 250 });
    expect(estimateTokens(index)).toBeLessThanOrEqual(250);
    expect(index).toContain("- Topic 1 → .harness/notes/n1.md");
    expect(index).toContain(`- Topic 3 (t3): ${"x".repeat(400)} → .harness/notes/n3.md`);
    expect(index).not.toContain("decision 1");
  });

  it("drops the oldest notes when even their titles don't fit", () => {
    const many = Array.from({ length: 40 }, (_, i) => note(i, { title: `A rather long topic title number ${i}` }));
    const index = buildNotesIndex(many, { budgetTokens: 100 });
    expect(estimateTokens(index)).toBeLessThanOrEqual(100);
    expect(index).toContain("A rather long topic title number 39");
    expect(index).not.toContain("A rather long topic title number 0 ");
    expect(index).toMatch(/- … \d+ older notes in \.harness\/notes\//);
  });

  it("stays within about 1,500 tokens by default", () => {
    const many = Array.from({ length: 60 }, (_, i) => note(i, { summary: ["y".repeat(300)] }));
    expect(estimateTokens(buildNotesIndex(many))).toBeLessThanOrEqual(1500);
  });
});
```

Run: `corepack pnpm vitest run packages/workspace/test/notes-index.test.ts`
Expected: FAIL (`buildNotesIndex` doesn't exist).

- [ ] **Step 2: Implement**

Create `packages/workspace/src/notes-index.ts`:
```ts
import type { Note } from "./notes";

/** About how many tokens the index may take in a session's first message (spec §5.2). */
export const INDEX_BUDGET_TOKENS = 1500;

/** Rough token count: characters / 4. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** The newest `full` notes keep their summary (and give their decisions); the rest of the first `shown` keep title and path. */
function renderIndex(sorted: Note[], full: number, shown: number): string {
  const covered = sorted.slice(0, shown).map((n, i) =>
    i < full && n.summary.length > 0
      ? `- ${n.title}${n.action ? ` (${n.action})` : ""}: ${n.summary.join("; ")} → ${n.path}`
      : `- ${n.title} → ${n.path}`,
  );
  if (shown < sorted.length) covered.push(`- … ${sorted.length - shown} older notes in .harness/notes/`);
  const decisions = sorted
    .slice(0, full)
    .flatMap((n) => n.decisions)
    .map((d) => `- ${d}`);
  return [
    "## What we already covered",
    ...covered,
    ...(decisions.length ? ["", "## Decisions so far", ...decisions] : []),
    "",
    "Open a note with your read tool when you need its details.",
  ].join("\n");
}

/**
 * The notes index for a new session's first message: what was covered and the decisions so far,
 * newest first, within about `budgetTokens`. Past the budget the oldest notes keep only their title
 * and path; if that is still too long the oldest are left out. Empty when there are no notes.
 */
export function buildNotesIndex(notes: Note[], opts: { budgetTokens?: number } = {}): string {
  if (notes.length === 0) return "";
  const budget = opts.budgetTokens ?? INDEX_BUDGET_TOKENS;
  const sorted = [...notes].sort((a, b) => b.date.localeCompare(a.date));
  for (let full = sorted.length; full >= 0; full--) {
    const text = renderIndex(sorted, full, sorted.length);
    if (estimateTokens(text) <= budget) return text;
  }
  for (let shown = sorted.length - 1; shown > 1; shown--) {
    const text = renderIndex(sorted, 0, shown);
    if (estimateTokens(text) <= budget) return text;
  }
  return renderIndex(sorted, 0, 1);
}
```

In `packages/workspace/src/index.ts`, add:
```ts
export * from "./notes-index";
```

- [ ] **Step 3: Run the tests**

Run: `corepack pnpm vitest run packages/workspace`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/workspace
git commit -m "feat(workspace): notes index within a token budget"
```

---

## Phase 3 — Runtime

### Task 7: Fake agents — Claude turns by prompt, a prompt log, ACP `session/close`

The fake agents grow what the runtime, shell and E2E tests need: fake-claude can pick its steps by the prompt it receives and log every run's argv and prompt; fake-acp can advertise and answer `session/close`, and numbers the sessions it creates.

**Files:**
- Modify: `packages/fake-agent/src/script.ts`, `packages/fake-agent/src/fake-claude.ts`, `packages/fake-agent/src/fake-acp.ts`

- [ ] **Step 1: Extend the scripts**

In `packages/fake-agent/src/script.ts`, replace the `ClaudeScript` interface with:
```ts
/** Script for fake-claude: printed lines, side effects, then exit. */
export interface ClaudeScript {
  steps: ClaudeStep[];
  /**
   * Per-prompt steps: the first entry whose `match` (a regular expression) matches the prompt read
   * from stdin runs instead of `steps`.
   */
  turns?: { match: string; steps: ClaudeStep[] }[];
  stderr?: string;
  exitCode?: number;
  /** Fail with this error result (exit 1) instead of running `steps`, but only when argv contains `--resume`. */
  failOnResume?: string;
}
```
and add to `AcpScript`, after `failLoad`:
```ts
  /** Advertise `sessionCapabilities.close` and answer `session/close`. */
  closeSession?: boolean;
```

- [ ] **Step 2: fake-claude**

Replace `packages/fake-agent/src/fake-claude.ts` with:
```ts
// Stand-in for `claude -p ... --output-format stream-json`. Reads its script from HH_FAKE_SCRIPT,
// records its argv in HH_FAKE_ARGS, the prompt in HH_FAKE_STDIN, and appends {argv, prompt} for
// every run to HH_FAKE_PROMPTS, so tests can assert on the flags and messages the runtime sent.
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { callMcpTool } from "./mcp-call";
import type { ClaudeScript } from "./script";

const argv = process.argv.slice(2);
if (process.env.HH_FAKE_ARGS) writeFileSync(process.env.HH_FAKE_ARGS, JSON.stringify(argv));
const script = JSON.parse(readFileSync(process.env.HH_FAKE_SCRIPT!, "utf8")) as ClaudeScript;
let input = "";
if (process.env.HH_FAKE_STDIN || process.env.HH_FAKE_PROMPTS || script.turns) {
  for await (const chunk of process.stdin) input += chunk;
  if (process.env.HH_FAKE_STDIN) writeFileSync(process.env.HH_FAKE_STDIN, input);
  if (process.env.HH_FAKE_PROMPTS) appendFileSync(process.env.HH_FAKE_PROMPTS, JSON.stringify({ argv, prompt: input }) + "\n");
}
const mcpIndex = argv.indexOf("--mcp-config");
const mcpConfig = mcpIndex >= 0 ? (JSON.parse(argv[mcpIndex + 1]) as { mcpServers: Record<string, any> }) : { mcpServers: {} };

if (script.failOnResume && argv.includes("--resume")) {
  process.stdout.write(JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: script.failOnResume }) + "\n");
  process.exit(1);
}

const steps = script.turns?.find((t) => new RegExp(t.match).test(input))?.steps ?? script.steps;
for (const step of steps) {
  if ("line" in step) process.stdout.write(JSON.stringify(step.line) + "\n");
  else if ("raw" in step) process.stdout.write(step.raw);
  else if ("sleep" in step) await new Promise((r) => setTimeout(r, step.sleep));
  else if ("spawnStubborn" in step) {
    spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: ["ignore", "ignore", "inherit"] });
  } else if ("signal" in step) {
    process.kill(process.pid, step.signal);
    await new Promise((r) => setTimeout(r, 5000));
  } else if ("write" in step) {
    mkdirSync(path.dirname(path.resolve(step.write.path)), { recursive: true });
    writeFileSync(path.resolve(step.write.path), step.write.content);
  } else if ("mcp" in step) {
    const s = mcpConfig.mcpServers[step.mcp.server];
    if (!s) throw new Error(`fake-claude: mcp step names unknown server "${step.mcp.server}" (configured: ${Object.keys(mcpConfig.mcpServers).join(", ") || "none"})`);
    await callMcpTool({ command: s.command, args: s.args ?? [], env: s.env ?? {} }, step.mcp.tool, step.mcp.args);
  }
}
if (script.stderr) process.stderr.write(script.stderr);
process.exitCode = script.exitCode ?? 0;
```

- [ ] **Step 3: fake-acp**

In `packages/fake-agent/src/fake-acp.ts`:

Add after `let turn = 0;`:
```ts
let sessions = 0;
```
Replace the `initialize` handler's `return { … };` with:
```ts
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: Boolean(script.loadSession),
        ...(script.closeSession ? { sessionCapabilities: { close: {} } } : {}),
      },
      ...(script.agentVersion ? { agentInfo: { name: "fake-acp", version: script.agentVersion } } : {}),
    };
```
Replace the `session/new` handler's `return { sessionId: script.sessionId ?? "fake-acp-session" };` with:
```ts
    const base = script.sessionId ?? "fake-acp-session";
    sessions++;
    return { sessionId: sessions === 1 ? base : `${base}-${sessions}` };
```
Add after the `session/set_mode` handler:
```ts
  .onRequest("session/close", (ctx) => {
    log("session/close", ctx.params);
    return {};
  })
```

- [ ] **Step 4: Check nothing changed for the existing tests**

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS (the new fields are optional; Tasks 8 and 10 test them).

- [ ] **Step 5: Commit**

```bash
git add packages/fake-agent
git commit -m "test(fake-agent): Claude turns by prompt, a prompt log, ACP session/close"
```

### Task 8: Transports — end a session

**Files:**
- Modify: `packages/runtime/src/transport.ts`, `packages/runtime/src/claude-cli.ts`, `packages/runtime/src/acp.ts`
- Test: `packages/runtime/test/claude-cli.test.ts`, `packages/runtime/test/acp.test.ts`

- [ ] **Step 1: Failing tests**

Append inside `describe("ClaudeCliTransport")` in `packages/runtime/test/claude-cli.test.ts`:
```ts
  it("starts a new session after endSession", async () => {
    const { transport, args, started } = setup({ steps: [...claudeTextLines("ok"), claudeResultLine(true)] }, { id: "old-1", started: true });
    await run(transport);
    expect(args()[args().indexOf("--resume") + 1]).toBe("old-1");
    await transport.endSession();
    await run(transport);
    const id = args()[args().indexOf("--session-id") + 1];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(id).not.toBe("old-1");
    expect(args()).not.toContain("--resume");
    expect(started).toEqual([{ id, started: true }]);
  });
```

Append inside `describe("AcpTransport")` in `packages/runtime/test/acp.test.ts`:
```ts
  it("closes the session on endSession and opens a new one on the next turn, in the same process", async () => {
    const { transport, log, started } = setup({ closeSession: true, sessionId: "s", turns: [[chunk("a")], [chunk("b")]] });
    await run(transport);
    await transport.endSession();
    const events = await run(transport);
    expect(events).toEqual([{ type: "text", delta: "b" }, { type: "done", ok: true }]);
    expect(log().filter((l) => l.method === "session/close").map((l) => l.params.sessionId)).toEqual(["s"]);
    expect(log().filter((l) => l.method === "session/new")).toHaveLength(2);
    expect(log().filter((l) => l.method === "initialize")).toHaveLength(1);
    expect(started.map((s) => s.id)).toEqual(["s", "s-2"]);
    expect(log().filter((l) => l.method === "session/set_mode").map((l) => l.params.sessionId)).toEqual(["s", "s-2"]);
  });

  it("skips session/close when the agent doesn't offer it, and still starts a new session", async () => {
    const { transport, log } = setup({ turns: [[chunk("a")], [chunk("b")]] });
    await run(transport);
    await transport.endSession();
    await run(transport);
    expect(log().some((l) => l.method === "session/close")).toBe(false);
    expect(log().filter((l) => l.method === "session/new")).toHaveLength(2);
  });

  it("does nothing on endSession before the first turn", async () => {
    const { transport, log } = setup({ closeSession: true, turns: [] });
    await transport.endSession();
    expect(log()).toEqual([]);
  });
```

Run: `corepack pnpm vitest run packages/runtime/test/claude-cli.test.ts packages/runtime/test/acp.test.ts`
Expected: FAIL (`endSession` is not a function).

- [ ] **Step 2: Transport contract**

In `packages/runtime/src/transport.ts`, replace the `Transport` interface with:
```ts
export interface Transport {
  /** Runs one turn. Emits events and always finishes with exactly one `done` event before resolving. */
  turn(message: string, emit: (event: Event) => void, signal: AbortSignal): Promise<void>;
  /** Ends the current engine session; the next turn starts a new one. Never called during a turn. */
  endSession(): Promise<void>;
  close(): Promise<void>;
}
```

- [ ] **Step 3: Claude**

In `packages/runtime/src/claude-cli.ts`, add before `async close(): Promise<void> {}`:
```ts
  /** Claude keeps the old session on its side; the app never resumes it. The next turn uses a new `--session-id`. */
  async endSession(): Promise<void> {
    this.o.session = { id: randomUUID(), started: false };
  }
```

- [ ] **Step 4: ACP — split connecting from opening a session**

In `packages/runtime/src/acp.ts`:

Add to the imports:
```ts
import { randomUUID } from "node:crypto";
```
Add after `private stderrTail = "";`:
```ts
  /** What the agent advertised at initialize. */
  private loadable = false;
  private closable = false;
```
Replace the whole `private async start(): Promise<void> { … }` method with these three methods:
```ts
  /** Starts the agent process and initializes the connection. */
  private async connect(): Promise<void> {
    const [binary, ...args] = this.o.command;
    const child = spawn(binary, args, {
      cwd: this.o.folder,
      env: { ...process.env, ...this.o.env },
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    this.child = child;
    this.stderrTail = "";
    child.on("exit", () => {
      if (this.child === child) this.reset();
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", reject);
    });
    child.on("error", () => {}); // late errors (e.g. a failed kill) must not be uncaught
    child.stderr!.on("data", (d: Buffer) => {
      this.stderrTail = (this.stderrTail + d.toString()).slice(-STDERR_KEEP);
    });

    const policy: PermissionPolicy = {
      folder: this.o.folder,
      permissions: this.o.permissions,
      mcpServers: this.o.mcp.map((s) => s.name),
      lookup: (id) => this.calls.get(id),
    };
    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
    );
    this.conn = acp
      .client({ name: "humanharness" })
      .onRequest("session/request_permission", (ctx) => decidePermission(ctx.params as PermissionRequest, policy) as never)
      .onNotification("session/update", (ctx) => this.onUpdate(ctx.params.update as Record<string, any>))
      .connect(stream);

    const init = await this.conn.agent.request("initialize", {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });
    const version = (init as { agentInfo?: { version?: string } | null }).agentInfo?.version;
    if (this.o.minAdapterVersion && version && versionLess(version, this.o.minAdapterVersion)) {
      throw new OutdatedAdapterError(`ACP adapter ${version} is older than required ${this.o.minAdapterVersion}`);
    }
    this.loadable = Boolean(init.agentCapabilities?.loadSession);
    this.closable = Boolean(init.agentCapabilities?.sessionCapabilities?.close);
  }

  private mcpServers() {
    return this.o.mcp.map((s) => ({
      name: s.name,
      command: s.command,
      args: s.args,
      env: Object.entries(s.env).map(([name, value]) => ({ name, value })),
    }));
  }

  /** Loads the saved session (when there is one and the agent can) or creates a new one, then sets its mode. */
  private async openSession(): Promise<void> {
    const agent = this.conn!.agent;
    const mcpServers = this.mcpServers();
    if (this.o.session.started && this.loadable) {
      try {
        await agent.request("session/load", { sessionId: this.o.session.id, cwd: this.o.folder, mcpServers });
        this.sessionId = this.o.session.id;
      } catch (e) {
        // An expired login must surface; any other load failure (lost session) falls back to a fresh one.
        const event = errorFrom(e);
        if (event.type === "done" && !event.ok && event.error?.code === "session-expired") throw e;
      }
    }
    if (!this.sessionId) {
      const created = (await agent.request("session/new", { cwd: this.o.folder, mcpServers })) as { sessionId: string };
      this.sessionId = created.sessionId;
      this.o.session = { id: created.sessionId, started: true };
      this.o.onSessionStarted(this.o.session);
    }
    if (this.o.sessionMode) {
      await agent.request("session/set_mode", { sessionId: this.sessionId, modeId: this.o.sessionMode });
    }
  }
```
In `turn`, replace
```ts
    if (!this.conn) {
      try {
        await this.start();
      } catch (e) {
```
with
```ts
    if (!this.conn || !this.sessionId) {
      try {
        if (!this.conn) await this.connect();
        await this.openSession();
      } catch (e) {
```
Add before `async close(): Promise<void> {`:
```ts
  /** Closes the session (`session/close`, when the agent offers it) and keeps the process for the next one. */
  async endSession(): Promise<void> {
    const sessionId = this.sessionId;
    this.sessionId = undefined;
    this.o.session = { id: randomUUID(), started: false };
    if (!sessionId || !this.conn || !this.closable) return;
    try {
      await this.conn.agent.request("session/close", { sessionId });
    } catch {
      // The next turn opens a new session anyway.
    }
  }
```

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/runtime`
Expected: PASS (the earlier ACP tests still pass: connecting and opening the first session behave as before).

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime
git commit -m "feat(runtime): end an engine session (new session id for Claude, session/close for Codex)"
```

### Task 9: Transports — read-only reference folders

**Files:**
- Modify: `packages/runtime/src/transport.ts`, `packages/runtime/src/claude-cli.ts`, `packages/runtime/src/acp.ts`
- Test: `packages/runtime/test/claude-cli.test.ts`, `packages/runtime/test/acp.test.ts`

- [ ] **Step 1: Failing tests**

Append to `packages/runtime/test/claude-cli.test.ts`:
```ts
describe("reference folders", () => {
  it("adds each reference folder with --add-dir and denies edits there", () => {
    const args = claudeArgs({ session: { id: "a", started: false }, mcp: [], permissions, references: ["/Users/me/code/hh", "/opt/docs"] });
    const at = args.indexOf("--add-dir");
    expect(args.slice(at, at + 4)).toEqual(["--add-dir", "/Users/me/code/hh", "--add-dir", "/opt/docs"]);
    const denied = args[args.indexOf("--disallowedTools") + 1].split(",");
    expect(denied).toEqual(
      expect.arrayContaining(["Edit(//Users/me/code/hh/**)", "Write(//Users/me/code/hh/**)", "MultiEdit(//Users/me/code/hh/**)", "Edit(//opt/docs/**)"]),
    );
    expect(claudeArgs({ session: { id: "a", started: false }, mcp: [], permissions })).not.toContain("--add-dir");
  });

  it("keeps the read tools allowed", () => {
    expect(allowedTools({ edit: "none", exec: false, web: false }, [])).toEqual(["Read", "Glob", "Grep", "TodoWrite"]);
    expect(disallowedTools({ edit: "none", exec: false, web: false }, ["/r"])).toContain("Write(//r/**)");
  });
});
```

In `packages/runtime/test/acp.test.ts`, append inside `describe("decidePermission")`, after the test "never picks an 'always' option":
```ts
  it("allows reads in the reference folders but never edits there", () => {
    const withRefs: PermissionPolicy = { ...policy(), readRoots: ["/ref"] };
    const decide = (toolCall: Record<string, unknown>) =>
      chosen(decidePermission({ sessionId: "s", toolCall: { toolCallId: "t", ...toolCall }, options } as never, withRefs));
    expect(decide({ kind: "read", locations: [{ path: "/ref/docs/a.md" }] })).toBe("allow");
    expect(decide({ kind: "search", locations: [{ path: "/ref" }] })).toBe("allow");
    expect(decide({ kind: "read", locations: [{ path: "/work/a.md" }, { path: "/ref/b.md" }] })).toBe("allow");
    expect(decide({ kind: "read", locations: [{ path: "/elsewhere/a.md" }] })).toBe("cancel");
    expect(decide({ kind: "read", locations: [{ path: "/reference/a.md" }] })).toBe("cancel");
    expect(decide({ kind: "edit", locations: [{ path: "/ref/a.md" }] })).toBe("cancel");
  });
```
change the `extra` parameter of the `setup` helper to:
```ts
  extra: { minAdapterVersion?: string; references?: string[] } = {},
```
and append inside `describe("AcpTransport")`:
```ts
  it("lets the agent read the reference folders", async () => {
    const { transport, log } = setup(
      { turns: [[{ permission: { toolCall: { toolCallId: "r1", kind: "read", locations: [{ path: "/ref/docs/a.md" }] } } }]] },
      undefined,
      { references: ["/ref"] },
    );
    await run(transport);
    expect(log().find((l) => l.method === "permission-outcome")?.params).toEqual({ outcome: "selected", optionId: "allow" });
  });
```

Run: `corepack pnpm vitest run packages/runtime/test/claude-cli.test.ts packages/runtime/test/acp.test.ts`
Expected: FAIL (`references` and `readRoots` are unknown).

- [ ] **Step 2: Implement**

In `packages/runtime/src/transport.ts`, add to `TransportOptions` after `permissions`:
```ts
  /** Folders the agent may read but never change (absolute paths). */
  references?: string[];
```

In `packages/runtime/src/claude-cli.ts`, replace `disallowedTools` with:
```ts
/** Deny rules beat allow rules, so project settings or hooks cannot re-enable what the manifest excludes. */
export function disallowedTools(permissions: Permissions, references: string[] = []): string[] {
  const tools = ["AskUserQuestion"];
  if (permissions.edit === "none") tools.push("Edit", "Write", "MultiEdit", "NotebookEdit");
  if (!permissions.exec) tools.push("Bash");
  if (!permissions.web) tools.push("WebSearch", "WebFetch");
  tools.push("Edit(.claude/**)", "Write(.claude/**)", "MultiEdit(.claude/**)");
  // `--add-dir` makes a reference folder a working directory, where acceptEdits would accept edits:
  // deny them by absolute path (`//` starts an absolute path in permission rules).
  for (const dir of references) tools.push(`Edit(/${dir}/**)`, `Write(/${dir}/**)`, `MultiEdit(/${dir}/**)`);
  return tools;
}
```
In `claudeArgs`, change the parameter type to `Pick<TransportOptions, "session" | "mcp" | "permissions" | "persistSession" | "references">`, replace the `--disallowedTools` line with:
```ts
    "--disallowedTools", disallowedTools(o.permissions, o.references ?? []).join(","),
```
and add after the `"--mcp-config", JSON.stringify({ mcpServers }),` line:
```ts
    ...(o.references ?? []).flatMap((dir) => ["--add-dir", dir]),
```

In `packages/runtime/src/acp.ts`, add to `PermissionPolicy` after `folder`:
```ts
  /** Reference folders: reads and searches there are allowed, never edits. */
  readRoots?: string[];
```
replace the `read` / `search` / `think` case of `decidePermission` with:
```ts
      case "read":
      case "search":
      case "think":
        allow = (locations ?? []).every((l) => [policy.folder, ...(policy.readRoots ?? [])].some((root) => inside(root, l.path)));
        break;
```
and in `connect`, add to the `policy` object after `permissions: this.o.permissions,`:
```ts
      readRoots: this.o.references ?? [],
```

- [ ] **Step 3: Run the tests**

Run: `corepack pnpm vitest run packages/runtime`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/runtime
git commit -m "feat(runtime): read-only reference folders (--add-dir for Claude, read permissions for Codex)"
```

### Task 10: Runtime — sessions from outside, core blocks, references

**Files:**
- Modify: `packages/runtime/src/runtime.ts`, `packages/runtime/src/dev.ts`
- Test: `packages/runtime/test/runtime.test.ts`

- [ ] **Step 1: Failing tests**

In `packages/runtime/test/runtime.test.ts`, replace the runtime import with:
```ts
import { type HarnessRuntime, type RuntimeOptions, createRuntime } from "../src/runtime";
import type { Session } from "../src/transport";
```
replace the `setup` helper with:
```ts
async function setup(script: ClaudeScript, folder = path.join(fs.mkdtempSync(path.join(root, "t-")), "Work"), extra: Partial<RuntimeOptions> = {}) {
  const argsFile = path.join(root, `args-${Date.now()}-${Math.random()}.json`);
  const prompts = path.join(root, `prompts-${Date.now()}-${Math.random()}.jsonl`);
  runtime = await createRuntime({
    harness: await loadHarness(FIXTURE),
    engine: getEngine("claude"),
    folder,
    gitdir: path.join(path.dirname(folder), "history.git"),
    language: "en",
    command: fakeClaudeCommand(),
    env: { HH_FAKE_SCRIPT: writeScript(root, script), HH_FAKE_ARGS: argsFile, HH_FAKE_PROMPTS: prompts },
    ...extra,
  });
  const runs = () => fs.readFileSync(prompts, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { argv: string[]; prompt: string });
  return { runtime, folder, args: () => JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[], runs };
}
```
and replace the test "persists the session and resumes it in the next runtime" with:
```ts
  it("continues the session it is given, reports new ones, and starts a fresh one after endSession", async () => {
    const reported: Session[] = [];
    const { runtime, folder, runs } = await setup({ steps: [...claudeTextLines("ok"), claudeResultLine(true)] }, undefined, {
      session: { id: "given-1", started: true },
      onSession: (s) => reported.push(s),
    });
    await send(runtime, "first");
    await runtime.endSession();
    await send(runtime, "second");
    const [one, two] = runs();
    expect([one.prompt, two.prompt]).toEqual(["first", "second"]);
    expect(one.argv[one.argv.indexOf("--resume") + 1]).toBe("given-1");
    const fresh = two.argv[two.argv.indexOf("--session-id") + 1];
    expect(fresh).not.toBe("given-1");
    expect(reported).toEqual([{ id: fresh, started: true }]);
    expect(fs.existsSync(path.join(folder, ".harness", "session.json"))).toBe(false);
  });

  it("refuses to end the session during a turn", async () => {
    const { runtime } = await setup({ steps: [{ sleep: 2000 }] });
    const turn = runtime.send("one", () => {});
    await expect(runtime.endSession()).rejects.toThrow(/already running/);
    turn.cancel();
    await turn.done;
  });

  it("documents the core blocks and the reference folders, and lets Claude read those folders", async () => {
    const ref = fs.mkdtempSync(path.join(root, "ref-"));
    const { runtime, folder, args } = await setup({ steps: [...claudeTextLines("ok"), claudeResultLine(true)] }, undefined, {
      references: [{ label: "Source", path: ref }],
    });
    const agents = fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8");
    expect(agents).toContain("`show_choices`");
    expect(agents).toContain("`save_note`");
    expect(agents).toContain(`- Source: \`${ref}\``);
    await send(runtime);
    expect(args()[args().indexOf("--add-dir") + 1]).toBe(ref);
  });

  it("delivers a save_note call as a block event", async () => {
    const note = { title: "T", summary: ["a"], decisions: [], files: [], open: [] };
    const { runtime } = await setup({ steps: [{ mcp: { server: "ui", tool: "save_note", args: note } }, claudeResultLine(true)] });
    expect(await send(runtime)).toContainEqual({ type: "block", name: "save_note", data: note });
  });
```

Run: `corepack pnpm vitest run packages/runtime/test/runtime.test.ts`
Expected: FAIL (`endSession`, `session`, `onSession` and `references` don't exist; the core blocks aren't in `AGENTS.md`).

- [ ] **Step 2: Implement**

Replace `packages/runtime/src/runtime.ts` with:
```ts
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { type Bridge, type Launcher, type McpServerSpec, devLauncher, openBridge, uiServerSpec } from "@humanharness/blocks";
import type { EngineDef } from "@humanharness/engines";
import { type Language, type LoadedHarness, allBlocks, resolveInHarness } from "@humanharness/harness-sdk";
import { History, NOTES_PREFIX, type ReferenceFolder, prepareFolder, writeInstructions } from "@humanharness/workspace";
import { AcpTransport } from "./acp";
import { ClaudeCliTransport } from "./claude-cli";
import type { Event } from "./events";
import type { Session, Transport, TransportOptions } from "./transport";

export interface RuntimeOptions {
  /** Built `ui` MCP server entry (app). Defaults to the TS source (dev). */
  uiServerEntry?: string;
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
  /** Folders the agent may read but never change (absolute paths), with the label `AGENTS.md` shows. */
  references?: ReferenceFolder[];
  /** The engine session to continue (the dev CLI). Default: a new one. */
  session?: Session;
  /** Called when the engine starts a session. */
  onSession?: (session: Session) => void;
}

export interface RunningTurn {
  cancel(): void;
  done: Promise<void>;
}

export interface HarnessRuntime {
  send(message: string, emit: (e: Event) => void): RunningTurn;
  /** Ends the engine session (Codex: `session/close`); the next turn starts a new one. Not while a turn runs. */
  endSession(): Promise<void>;
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
  const references = opts.references ?? [];

  await prepareFolder(folder, harness.folder.seed ? resolveInHarness(harness, harness.folder.seed) : undefined);
  const base = await fs.readFile(resolveInHarness(harness, harness.instructions), "utf8");
  const generated = await writeInstructions({ folder, base, language: opts.language, blocks: allBlocks(harness), references, engine });

  // The history skips the app's files under .harness/ (except the notes) and the generated instructions.
  const history = new History(folder, opts.gitdir, [".harness/", ...generated], [NOTES_PREFIX]);
  await history.init();
  await history.save("Start");

  let emitCurrent: ((e: Event) => void) | null = null;
  const session: Session = opts.session ?? { id: randomUUID(), started: false };
  const bridge: Bridge = await openBridge((m) => emitCurrent?.({ type: "block", name: m.name, data: m.data }));
  try {
    return await buildRuntime(bridge);
  } catch (err) {
    await bridge.close().catch(() => {});
    throw err;
  }

  async function buildRuntime(bridge: Bridge): Promise<HarnessRuntime> {
    const transportOptions: TransportOptions = {
      folder,
      session,
      mcp: [uiServerSpec({ harnessConfig: harness.configPath, bridge, launcher, entry: opts.uiServerEntry }), ...harnessMcpServers(harness, launcher)],
      permissions: harness.permissions,
      references: references.map((r) => r.path),
      sessionMode:
        engine.transport.kind === "acp"
          ? engine.transport.modes?.[harness.permissions.edit === "folder" ? "edit" : "readOnly"]
          : undefined,
      minAdapterVersion: engine.transport.kind === "acp" ? engine.transport.minAdapterVersion : undefined,
      command: opts.command ?? (engine.transport.kind === "claude-cli" ? [engine.transport.binary] : engine.transport.command),
      env: opts.env,
      onSessionStarted: (s) => {
        try {
          opts.onSession?.(s);
        } catch (err) {
          console.error("Could not record the engine session", err);
        }
      },
    };
    const transport: Transport =
      engine.transport.kind === "claude-cli" ? new ClaudeCliTransport(transportOptions) : new AcpTransport(transportOptions);

    let busy = false;
    let current: { controller: AbortController; done: Promise<void> } | null = null;

    return {
      history,
      send(message, emit) {
        if (busy) throw new Error("A turn is already running");
        busy = true;
        const controller = new AbortController();
        let doneEmitted = false;
        const emitOnce = (e: Event) => {
          if (e.type === "done") {
            if (doneEmitted) return;
            doneEmitted = true;
          }
          emit(e);
        };
        const done = (async () => {
          try {
            const before = (await history.save("Before message")) ?? (await history.last())!;
            let final: Event | undefined;
            emitCurrent = emitOnce;
            await transport.turn(
              message,
              (e) => {
                if (final) return;
                if (e.type === "done") final = e;
                else emitOnce(e);
              },
              controller.signal,
            );
            emitCurrent = null;
            const f: Event = final ?? { type: "done", ok: false, error: { code: "agent-crashed" } };
            if (f.type === "done" && f.ok) await history.save(`Turn: ${message.slice(0, 60)}`);
            else if (f.type === "done" && f.error.code === "agent-crashed") await history.restore(before, "Undo: the turn did not finish");
            else await history.save(`Stopped: ${message.slice(0, 60)}`);
            emitOnce(f);
          } catch (err) {
            emitOnce({ type: "done", ok: false, error: { code: "agent-crashed", detail: err instanceof Error ? err.message : String(err) } });
          } finally {
            emitCurrent = null;
            busy = false;
          }
        })();
        current = { controller, done };
        return { cancel: () => controller.abort(), done };
      },
      async endSession() {
        if (busy) throw new Error("A turn is already running");
        await transport.endSession();
      },
      async close() {
        if (current) {
          current.controller.abort();
          await current.done;
        }
        try {
          await transport.close();
        } finally {
          await bridge.close();
        }
      },
    };
  }
}
```

In `packages/runtime/src/dev.ts`, add the import:
```ts
import { readSession, writeSession } from "./session-store";
```
and add to the `createRuntime({ … })` options, after `language: values.language as Language,`:
```ts
  // The dev CLI keeps one session per folder in .harness/session.json, so each run continues the last.
  session: await readSession(folder, engine.id),
  onSession: (s) => void writeSession(folder, engine.id, s).catch(() => {}),
```

- [ ] **Step 3: Run the tests**

Run: `corepack pnpm vitest run packages/runtime`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS (the shell's turn tests use a fake runtime cast from `unknown`).

- [ ] **Step 4: Commit**

```bash
git add packages/runtime
git commit -m "feat(runtime): sessions from outside, endSession, core blocks and references in AGENTS.md"
```

---

## Phase 4 — Shell

### Task 11: Usage log and turn controller — task, phase, quiet turns

**Files:**
- Modify: `packages/shell/src/main/usage-log.ts`, `packages/shell/src/main/turn-controller.ts`, `packages/shell/src/main/index.ts`, `packages/ui/src/client.ts`
- Test: `packages/shell/test/usage-log.test.ts`, `packages/shell/test/turn-controller.test.ts`

- [ ] **Step 1: Failing tests**

In `packages/shell/test/usage-log.test.ts`, replace `usageRecord({ ...entry, usage, error: { code: "cancelled" } }, "codex", "tidy")` with `usageRecord({ ...entry, usage, error: { code: "cancelled" } }, "codex", { action: "tidy" })`, replace `usageRecord({ ...entry, limits: last }, "claude", "tidy", first)` with `usageRecord({ ...entry, limits: last }, "claude", { action: "tidy" }, first)`, and append inside `describe("usageRecord")`:
```ts
  it("tags the record with its task and phase", () => {
    const usage = { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 };
    expect(usageRecord({ ...entry, usage }, "claude", { action: "turn", task: "t1", phase: "close" })).toEqual({
      at: "2026-10-11T14:00:00.000Z",
      engine: "claude",
      action: "turn",
      task: "t1",
      phase: "close",
      ok: true,
      usage,
    });
  });
```

In `packages/shell/test/turn-controller.test.ts`, add `import type { UsageMeta } from "../src/main/usage-log";`, replace
```ts
    const recorded: [ChatEntry, string | undefined, LimitWindow[] | undefined][] = [];
```
with
```ts
    const recorded: [ChatEntry, UsageMeta, LimitWindow[] | undefined][] = [];
```
replace
```ts
    expect(recorded).toEqual([[entries[1], "tidy", first]]);
```
with
```ts
    expect(recorded).toEqual([[entries[1], { action: "tidy" }, first]]);
```
and append:
```ts
describe("TurnController for tasks", () => {
  it("shows the display text and tags both entries with the task; the action only on the task's first turn", async () => {
    const fake = fakeRuntime();
    const { controller, entries } = setup({ ensureRuntime: async () => fake.runtime });
    const sent = controller.send("# Topic: engines\n(brief)", { action: "engines", task: "t1", display: "Engines" });
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    expect(fake.send.mock.calls[0][0]).toBe("# Topic: engines\n(brief)");
    fake.finish([{ type: "text", delta: "Hi" }, { type: "done", ok: true }]);
    await sent;
    expect(entries[0]).toMatchObject({ role: "user", text: "Engines", action: "engines", task: "t1" });
    expect(entries[1]).toMatchObject({ role: "assistant", text: "Hi", task: "t1" });

    const next = fakeRuntime();
    const second = setup({ ensureRuntime: async () => next.runtime });
    const followUp = second.controller.send("And the blocks?", { action: "engines", task: "t1", followUp: true });
    await vi.waitFor(() => expect(next.send).toHaveBeenCalled());
    next.finish([{ type: "done", ok: true }]);
    await followUp;
    expect(second.entries[0].action).toBeUndefined();
    expect(second.entries[0]).toMatchObject({ text: "And the blocks?", task: "t1" });
  });

  it("runs a quiet closing turn: nothing in the chat or the window, usage tagged close, every event to onEvent", async () => {
    const fake = fakeRuntime();
    const entries: ChatEntry[] = [];
    const events: Event[] = [];
    const seen: Event[] = [];
    const recorded: [string | undefined, UsageMeta][] = [];
    const controller = new TurnController({
      ensureRuntime: async () => fake.runtime,
      chatLog: async () => ({ append: async (e) => void entries.push(e) }),
      stateBlocks: () => new Set(["save_note"]),
      emit: (e) => events.push(e),
      recordUsage: async (entry, meta) => void recorded.push([entry.task, meta]),
    });
    const sent = controller.send("close please", { action: "turn", task: "t1", phase: "close", quiet: true, onEvent: (e) => seen.push(e) });
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    fake.finish([
      { type: "block", name: "save_note", data: { title: "T" } },
      { type: "usage", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      { type: "done", ok: true },
    ]);
    await sent;
    expect(entries).toEqual([]);
    expect(events).toEqual([]);
    expect(seen.map((e) => e.type)).toEqual(["block", "usage", "done"]);
    expect(recorded).toEqual([["t1", { action: "turn", task: "t1", phase: "close" }]]);
  });

  it("tells onEvent how the turn ended even when the engine can't start", async () => {
    const seen: Event[] = [];
    const { controller } = setup({ ensureRuntime: async () => null });
    await controller.send("hi", { onEvent: (e) => seen.push(e) });
    expect(seen).toEqual([{ type: "done", ok: false, error: { code: "engine-not-installed" } }]);
  });
});
```

Run: `corepack pnpm vitest run packages/shell/test/usage-log.test.ts packages/shell/test/turn-controller.test.ts`
Expected: FAIL (`usageRecord` takes an action string; `task`, `display`, `followUp`, `quiet`, `onEvent` are ignored).

- [ ] **Step 2: Usage log**

In `packages/shell/src/main/usage-log.ts`, add before `UsageRecord`:
```ts
/** Which task (and which of its phases) a turn belongs to. */
export interface UsageMeta {
  action?: string;
  task?: string;
  /** `run`: the task's own turns; `close`: the turn that asks for its note. */
  phase?: "run" | "close";
}
```
add to `UsageRecord` after `action?: string;`:
```ts
  task?: string;
  phase?: "run" | "close";
```
and replace `usageRecord` with:
```ts
/** The usage record for a finished turn, or null when the engine reported nothing. */
export function usageRecord(entry: ChatEntry, engine: string, meta: UsageMeta = {}, firstLimits?: LimitWindow[]): UsageRecord | null {
  if (!entry.usage && !entry.limits) return null;
  return {
    at: entry.at,
    engine,
    ...(meta.action ? { action: meta.action } : {}),
    ...(meta.task ? { task: meta.task } : {}),
    ...(meta.phase ? { phase: meta.phase } : {}),
    ok: !entry.error,
    ...(entry.usage ? { usage: entry.usage } : {}),
    ...(entry.limits ? { limits: entry.limits } : {}),
    ...(firstLimits ? { firstLimits } : {}),
  };
}
```

- [ ] **Step 3: Chat entries know their task**

In `packages/ui/src/client.ts`, add to `ChatEntry` after `engine?: string;`:
```ts
  /** The task the entry belongs to (flow mode shows one task at a time). */
  task?: string;
```

- [ ] **Step 4: Turn controller**

In `packages/shell/src/main/turn-controller.ts`, add the import:
```ts
import type { UsageMeta } from "./usage-log";
```
add after the `EngineUnavailable` class:
```ts
/** How the task manager runs a turn (the window's own sends only use `action`). */
export interface TurnOptions extends SendOptions {
  /** The task this turn belongs to: saved on its chat entries and in usage.jsonl. */
  task?: string;
  /** `close` for the turn that asks for the task's note. */
  phase?: "run" | "close";
  /** What the chat shows as the person's message when the engine gets something else (a task brief). */
  display?: string;
  /** A later turn of the same task: its chat entry isn't tagged with the action. */
  followUp?: boolean;
  /** Nothing goes to the chat or the window (the closing turn); usage is still recorded. */
  quiet?: boolean;
  /** Sees every event of the turn, its `done` included. */
  onEvent?: (e: Event) => void;
}
```
replace the `recordUsage` member of `TurnDeps` with:
```ts
  /** Saves the finished turn's usage (usage.jsonl), with the turn's first limits snapshot. Failures are logged, never thrown. */
  recordUsage?: (entry: ChatEntry, meta: UsageMeta, firstLimits: LimitWindow[] | undefined) => Promise<void>;
```
replace `send` and `run` with:
```ts
  /** Rejects when the app is closing, a turn is already running, or the app isn't set up. */
  send(message: string, options: TurnOptions = {}): Promise<void> {
    if (this.closed) return Promise.reject(new Error("The app is closing"));
    if (this.turn) return Promise.reject(new Error("A turn is already running"));
    this.active = this.run(message, options);
    return this.active;
  }

  private async run(message: string, options: TurnOptions): Promise<void> {
    const { action, task, phase, display, followUp, quiet, onEvent } = options;
    const turn: { cancelled: boolean; running: RunningTurn | null } = { cancelled: false, running: null };
    this.turn = turn;
    try {
      const log = await this.deps.chatLog();
      const engineId = await this.deps.engineId?.().catch(() => undefined);
      if (!log) throw new Error("The app is not set up yet");
      if (!quiet) {
        void this.write(log, {
          id: randomUUID(),
          role: "user",
          text: display ?? message,
          blocks: [],
          activities: [],
          at: new Date().toISOString(),
          ...(action && !followUp ? { action } : {}),
          ...(task ? { task } : {}),
        });
      }
      const recorder = new TurnRecorder(this.deps.stateBlocks());
      const meta: UsageMeta = { ...(action ? { action } : {}), ...(task ? { task } : {}), ...(phase ? { phase } : {}) };
      const finish = async (done: Done) => {
        const entry: ChatEntry = { ...recorder.finish(done), ...(task ? { task } : {}) };
        if (!quiet) await this.write(log, entry);
        await this.recordUsage(entry, meta, recorder.firstLimits);
        if (!done.ok && done.error?.code === "session-expired" && engineId) await this.forgetSession(engineId);
        this.tell(onEvent, done);
        if (!quiet) this.emit(done);
      };

      if (turn.cancelled) return await finish(fail("cancelled") as Done);
      let rt: HarnessRuntime | null;
      try {
        rt = await this.deps.ensureRuntime();
      } catch (e) {
        if (e instanceof EngineUnavailable) return await finish(fail(e.code) as Done);
        return await finish(fail("agent-crashed", e instanceof Error ? e.message : String(e)) as Done);
      }
      if (turn.cancelled) return await finish(fail("cancelled") as Done);
      if (!rt) return await finish(fail("engine-not-installed") as Done);

      let finished: Promise<void> = Promise.resolve();
      turn.running = rt.send(message, (e) => {
        if (e.type === "done") finished = finish(e);
        else {
          recorder.add(e);
          this.tell(onEvent, e);
          if (!quiet) this.emit(e);
        }
      });
      await turn.running.done;
      await finished;
    } finally {
      this.turn = null;
    }
  }

  /** Hands an event to the caller's listener; a throwing listener never breaks the turn. */
  private tell(onEvent: ((e: Event) => void) | undefined, e: Event): void {
    try {
      onEvent?.(e);
    } catch (err) {
      console.error("A turn listener failed", err);
    }
  }
```
and replace the private `recordUsage` method with:
```ts
  private async recordUsage(entry: ChatEntry, meta: UsageMeta, firstLimits: LimitWindow[] | undefined): Promise<void> {
    try {
      await this.deps.recordUsage?.(entry, meta, firstLimits);
    } catch (err) {
      console.error("Could not save usage", err);
    }
  }
```

In `packages/shell/src/main/index.ts`, replace the `recordUsage` dependency of `turns` with:
```ts
  recordUsage: async (entry, meta, firstLimits) => {
    const c = await validConfig();
    const record = c ? usageRecord(entry, c.engineId, meta, firstLimits) : null;
    if (c && record) await new UsageLog(c.folder).append(record);
  },
```

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/shell`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shell packages/ui/src/client.ts
git commit -m "feat(shell): turns carry their task and phase; quiet closing turns"
```

### Task 12: Client contract for tasks, notes and choices

**Files:**
- Modify: `packages/ui/src/client.ts`, `packages/ui/test/fake-client.ts`, `packages/shell/src/preload/index.ts`
- Test: `packages/ui/test/client.test.ts`

- [ ] **Step 1: Failing test**

In `packages/ui/test/client.test.ts`, change the import to:
```ts
import { type EngineStatus, engineProblem, nextInPath } from "../src/client";
```
and append:
```ts
describe("nextInPath", () => {
  const path = ["manifest", "engines", "turn"];
  it("follows the path from the current action", () => {
    expect(nextInPath(path, "manifest", {})).toBe("engines");
    expect(nextInPath(path, "engines", { manifest: "done" })).toBe("turn");
  });

  it("from the end, outside the path or idle, suggests the first action not done yet", () => {
    expect(nextInPath(path, "turn", { manifest: "done" })).toBe("engines");
    expect(nextInPath(path, "other", { manifest: "done", engines: "unfinished" })).toBe("engines");
    expect(nextInPath(path, undefined, { manifest: "done" })).toBe("engines");
    expect(nextInPath(path, "turn", { manifest: "done", engines: "done" })).toBeNull();
    expect(nextInPath([], undefined, {})).toBeNull();
  });
});
```

Run: `corepack pnpm vitest run packages/ui/test/client.test.ts`
Expected: FAIL (`nextInPath` doesn't exist).

- [ ] **Step 2: Contract**

In `packages/ui/src/client.ts`, replace the first import with:
```ts
import type { ActionCost, ChoiceOption, Language, LocalizedText } from "@humanharness/harness-sdk";
```
replace `ActionOption` with:
```ts
export interface ActionOption {
  label: LocalizedText;
  /** One line under the label on the topic card. */
  description?: LocalizedText;
  cost: ActionCost;
}

/** A read-only reference folder, as the work screen shows it ("~/…" for paths in the home folder). */
export interface ReferenceView {
  id: string;
  label: LocalizedText;
  path: string;
}
```
add to `AppState` after `actions`:
```ts
  /** The guided path: action ids in order. */
  path?: string[];
  /** Folders the agent can read but never change. */
  references?: ReferenceView[];
```
replace the `SendOptions` interface with:
```ts
export interface SendOptions {
  /**
   * The manifest action this message starts: a new task, whose first message is the action's brief (the
   * message is what the chat shows). Heavy actions may ask first.
   */
  action?: string;
}

/** Where the current task is: running a turn, waiting for the person, or closing (asking for its note). */
export type TaskStatus = "running" | "waiting" | "closing";
/** How an action's last task ended: its note was saved, the closing turn brought none, or it was interrupted. */
export type ActionStatus = "done" | "unsaved" | "unfinished";

export interface CurrentTaskView {
  id: string;
  /** Absent for a free question. */
  action?: string;
  status: TaskStatus;
}

/** A note in `.harness/notes/`, for the side panel and "Lo que quedó claro". */
export interface NoteView {
  slug: string;
  title: string;
  action?: string;
  date: string;
  summary: string[];
  decisions: string[];
  /** Relative to the folder: `.harness/notes/<slug>.md`. */
  path: string;
}

export interface TaskView {
  current: CurrentTaskView | null;
  actions: Record<string, ActionStatus>;
  /** Newest first. */
  notes: NoteView[];
}

/** The action to start after `current` on the guided path: the next one, or else the first one not done yet. */
export function nextInPath(path: string[], current: string | undefined, statuses: Record<string, ActionStatus>): string | null {
  const i = current ? path.indexOf(current) : -1;
  if (i >= 0 && i + 1 < path.length) return path[i + 1];
  return path.find((id) => id !== current && statuses[id] !== "done") ?? null;
}
```
add to `HarnessClient` after `revealFolder`:
```ts
  /** The current task, how each action ended, and the notes. */
  getTasks(): Promise<TaskView>;
  onTasks(listener: (view: TaskView) => void): () => void;
  /** The person picked an option of a `choices` block: a follow-up, another topic, or the next one on the path. */
  choose(option: ChoiceOption): Promise<void>;
  /** Opens a file inside the reference folders or the user's folder in its default app. False when refused or missing. */
  openPath(path: string): Promise<boolean>;
```
and replace the last line with:
```ts
export type { ChoiceOption, Event, EngineError, LimitWindow };
```

- [ ] **Step 3: Fake client and preload**

In `packages/ui/test/fake-client.ts`, add `ChoiceOption` and `TaskView` to the type import from `"../src/client"`, add after `revealed = 0;`:
```ts
  tasks: TaskView = { current: null, actions: {}, notes: [] };
  chosen: ChoiceOption[] = [];
  /** When set, choose rejects with it. */
  chooseError: Error | null = null;
  opened: string[] = [];
  /** What openPath answers. */
  openResult = true;
  private taskListeners = new Set<(v: TaskView) => void>();
```
and add after `revealFolder`:
```ts
  emitTasks(view: TaskView) {
    this.tasks = view;
    for (const l of this.taskListeners) l(view);
  }
  async getTasks() {
    return this.tasks;
  }
  onTasks(listener: (v: TaskView) => void) {
    this.taskListeners.add(listener);
    return () => {
      this.taskListeners.delete(listener);
    };
  }
  async choose(option: ChoiceOption) {
    this.chosen.push(option);
    if (this.chooseError) throw this.chooseError;
  }
  async openPath(file: string) {
    this.opened.push(file);
    return this.openResult;
  }
```

In `packages/shell/src/preload/index.ts`, replace the type import with:
```ts
import type { Event, HarnessClient, SetupOutput, TaskView } from "@humanharness/ui/client";
```
and add to `client` after `revealFolder`:
```ts
  getTasks: () => ipcRenderer.invoke("hh:getTasks"),
  onTasks: (listener) => subscribe<TaskView>("hh:tasks", listener),
  choose: (option) => ipcRenderer.invoke("hh:choose", option),
  openPath: (file) => ipcRenderer.invoke("hh:openPath", file),
```
(The main process answers these channels from Task 17.)

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/ui`
Expected: PASS (`client.ts` still imports only types).

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui packages/shell/src/preload
git commit -m "feat(ui): client contract for tasks, notes, choices and opening files"
```

### Task 13: Task store and engine switch

**Files:**
- Create: `packages/shell/src/main/task-store.ts`, `packages/shell/test/task-store.test.ts`
- Modify: `packages/shell/src/main/engine-switch.ts`
- Test: `packages/shell/test/engine-switch.test.ts`

- [ ] **Step 1: Failing tests**

Create `packages/shell/test/task-store.test.ts`:
```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type TasksFile, TaskStore, emptyTasks, interrupted } from "../src/main/task-store";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const tmp = () => fs.mkdtempSync(path.join(root, "f-"));

const waiting: TasksFile = {
  version: 1,
  engine: "claude",
  current: { id: "t1", action: "turn", status: "waiting", startedAt: "2026-10-12T10:00:00.000Z", turns: 2, session: { id: "s1", started: true } },
  actions: { manifest: "done" },
};

describe("TaskStore", () => {
  it("starts empty, saves atomically and reads back", async () => {
    const folder = tmp();
    const store = new TaskStore(folder);
    expect(await store.load()).toEqual(emptyTasks());
    await store.save(waiting);
    expect(await store.load()).toEqual(waiting);
    expect(fs.readdirSync(path.join(folder, ".harness"))).toEqual(["tasks.json"]);
  });

  it("keeps only what it understands", async () => {
    const folder = tmp();
    fs.mkdirSync(path.join(folder, ".harness"));
    fs.writeFileSync(
      path.join(folder, ".harness", "tasks.json"),
      JSON.stringify({ version: 1, actions: { a: "done", b: "weird" }, current: { id: 1 }, engine: 5 }),
    );
    expect(await new TaskStore(folder).load()).toEqual({ version: 1, current: null, actions: { a: "done" } });
    fs.writeFileSync(path.join(folder, ".harness", "tasks.json"), "{broken");
    expect(await new TaskStore(folder).load()).toEqual(emptyTasks());
  });

  it("after an engine change: no task carries over, statuses stay, the engine is forgotten", async () => {
    const folder = tmp();
    const store = new TaskStore(folder);
    await store.save(waiting);
    await store.forgetEngine();
    expect(await store.load()).toEqual({ version: 1, current: null, actions: { manifest: "done", turn: "unfinished" } });
  });
});

describe("interrupted", () => {
  it("ends the open task as unfinished, but a topic already done stays done", () => {
    expect(interrupted(waiting)).toEqual({ ...waiting, current: null, actions: { manifest: "done", turn: "unfinished" } });
    const again = { ...waiting, current: { ...waiting.current!, action: "manifest" } };
    expect(interrupted(again).actions).toEqual({ manifest: "done" });
    const question = { ...waiting, current: { ...waiting.current!, action: undefined } };
    expect(interrupted(question)).toEqual({ ...waiting, current: null });
    expect(interrupted(emptyTasks())).toEqual(emptyTasks());
  });
});
```

Append to `packages/shell/test/engine-switch.test.ts`:
```ts
describe("engine switch with tasks", () => {
  it("reads the engine from tasks.json, archives the chat, ends the open task and keeps the notes", async () => {
    const folder = await folderWith(null, true);
    fs.writeFileSync(
      path.join(folder, ".harness", "tasks.json"),
      JSON.stringify({
        version: 1,
        engine: "claude",
        current: { id: "t1", action: "turn", status: "waiting", startedAt: "t", turns: 1 },
        actions: { manifest: "done" },
      }),
    );
    fs.mkdirSync(path.join(folder, ".harness", "notes"));
    fs.writeFileSync(path.join(folder, ".harness", "notes", "manifest.md"), "---\ntitle: \"M\"\n---\n");
    expect(await sessionEngine(folder)).toBe("claude");
    expect(await startNewChatIfEngineChanged(folder, "codex")).toBe("claude");
    expect(JSON.parse(fs.readFileSync(path.join(folder, ".harness", "tasks.json"), "utf8"))).toEqual({
      version: 1,
      current: null,
      actions: { manifest: "done", turn: "unfinished" },
    });
    expect(fs.existsSync(path.join(folder, ".harness", "notes", "manifest.md"))).toBe(true);
    expect(await sessionEngine(folder)).toBeNull();
    expect(await startNewChatIfEngineChanged(folder, "codex")).toBeNull();
  });
});
```

Run: `corepack pnpm vitest run packages/shell/test/task-store.test.ts packages/shell/test/engine-switch.test.ts`
Expected: FAIL (`task-store` doesn't exist; `sessionEngine` doesn't read `tasks.json`).

- [ ] **Step 2: Task store**

Create `packages/shell/src/main/task-store.ts`:
```ts
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Session } from "@humanharness/runtime";
import type { ActionStatus, TaskStatus } from "@humanharness/ui/client";

/** The task in progress: one engine session from its first turn to its note. */
export interface CurrentTask {
  id: string;
  /** The manifest action; absent for a free question. */
  action?: string;
  /** The question that started a free-question task. */
  question?: string;
  status: TaskStatus;
  /** The engine session, once the engine started it. */
  session?: Session;
  startedAt: string;
  /** Turns finished so far. */
  turns: number;
  /** The agent's note for this task was written. */
  noteSaved?: boolean;
}

/** `<folder>/.harness/tasks.json`: the current task and how each action ended. Replaces the runtime's session.json. */
export interface TasksFile {
  version: 1;
  /** The engine that ran the last task. */
  engine?: string;
  current: CurrentTask | null;
  actions: Record<string, ActionStatus>;
}

export const emptyTasks = (): TasksFile => ({ version: 1, current: null, actions: {} });

const ACTION_STATUSES: readonly string[] = ["done", "unsaved", "unfinished"];
const TASK_STATUSES: readonly string[] = ["running", "waiting", "closing"];
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Keeps what has the right shape; anything else reads as "nothing". */
function clean(raw: unknown): TasksFile {
  if (!isObject(raw) || raw.version !== 1) return emptyTasks();
  const actions: Record<string, ActionStatus> = {};
  if (isObject(raw.actions)) {
    for (const [id, status] of Object.entries(raw.actions)) if (ACTION_STATUSES.includes(status as string)) actions[id] = status as ActionStatus;
  }
  const c = raw.current;
  const current =
    isObject(c) && typeof c.id === "string" && TASK_STATUSES.includes(c.status as string)
      ? ({ ...c, turns: typeof c.turns === "number" ? c.turns : 0 } as unknown as CurrentTask)
      : null;
  return { version: 1, ...(typeof raw.engine === "string" ? { engine: raw.engine } : {}), current, actions };
}

/** The open task ends without a note: its action is unfinished, unless an earlier task already got it done. */
export function interrupted(state: TasksFile): TasksFile {
  const c = state.current;
  if (!c) return state;
  if (!c.action) return { ...state, current: null };
  const status: ActionStatus = c.noteSaved || state.actions[c.action] === "done" ? "done" : "unfinished";
  return { ...state, current: null, actions: { ...state.actions, [c.action]: status } };
}

export class TaskStore {
  readonly file: string;

  constructor(folder: string) {
    this.file = path.join(folder, ".harness", "tasks.json");
  }

  async load(): Promise<TasksFile> {
    try {
      return clean(JSON.parse(await fs.readFile(this.file, "utf8")));
    } catch {
      return emptyTasks();
    }
  }

  /** Atomic: temp file + rename. */
  async save(state: TasksFile): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(state, null, 2));
      await fs.rename(tmp, this.file);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  /** After an engine change: the open task ends (its session belongs to the old engine) and the file no longer names that engine. */
  async forgetEngine(): Promise<void> {
    const { engine: _old, ...rest } = interrupted(await this.load());
    await this.save(rest);
  }
}
```

- [ ] **Step 3: Engine switch reads tasks.json**

In `packages/shell/src/main/engine-switch.ts`, add the import:
```ts
import { TaskStore } from "./task-store";
```
replace `sessionEngine` with:
```ts
/** The engine that ran the folder's last task (tasks.json), or of a plan 2 session.json, if any. */
export async function sessionEngine(folder: string): Promise<string | null> {
  const tasks = await new TaskStore(folder).load();
  if (tasks.engine) return tasks.engine;
  try {
    const saved = JSON.parse(await fs.readFile(sessionFile(folder), "utf8")) as { engine?: unknown };
    return typeof saved.engine === "string" ? saved.engine : null;
  } catch {
    return null;
  }
}
```
and in `startNewChatIfEngineChanged`, replace
```ts
  await fs.rm(sessionFile(folder), { force: true });
```
with
```ts
  await fs.rm(sessionFile(folder), { force: true });
  // The open task can't continue on another engine; the notes stay.
  await new TaskStore(folder).forgetEngine();
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/shell`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shell
git commit -m "feat(shell): tasks.json store; an engine switch ends the open task and keeps the notes"
```

### Task 14: Task prompts

**Files:**
- Create: `packages/shell/src/main/task-prompts.ts`, `packages/shell/test/task-prompts.test.ts`

- [ ] **Step 1: Failing tests**

Create `packages/shell/test/task-prompts.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { CLOSE_PROMPT, QUESTION_PROMPT, fillPrompt } from "../src/main/task-prompts";

const index = "## What we already covered\n- Engines → .harness/notes/engines.md";

describe("fillPrompt", () => {
  it("fills the language and the notes index", () => {
    expect(fillPrompt("Answer in {{language}}.\n\n{{ notesIndex }}", { language: "es", notesIndex: index })).toBe(`Answer in Spanish.\n\n${index}`);
    expect(fillPrompt("Answer in {{language}}.", { language: "en", notesIndex: "" })).toBe("Answer in English.");
  });

  it("appends the index when the brief has no place for it", () => {
    expect(fillPrompt("# Topic: blocks", { language: "en", notesIndex: index })).toBe(`# Topic: blocks\n\n${index}`);
  });

  it("leaves no run of blank lines when the index is empty", () => {
    expect(fillPrompt("Intro.\n\n{{notesIndex}}\n\nEnd.", { language: "en", notesIndex: "" })).toBe("Intro.\n\nEnd.");
  });

  it("keeps unknown placeholders and never fills values into inserted text", () => {
    expect(fillPrompt("{{other}} {{constructor}}", { language: "en", notesIndex: "" })).toBe("{{other}} {{constructor}}");
    expect(fillPrompt(QUESTION_PROMPT, { language: "en", notesIndex: "", question: "What is {{notesIndex}}?" })).toContain(
      "## Question\nWhat is {{notesIndex}}?",
    );
  });

  it("builds a free question's first message with the index", () => {
    const text = fillPrompt(QUESTION_PROMPT, { language: "es", notesIndex: index, question: "¿Dónde se guarda la conversación?" });
    expect(text).toContain("Answer it in Spanish");
    expect(text).toContain(index);
    expect(text.endsWith("## Question\n¿Dónde se guarda la conversación?")).toBe(true);
  });

  it("asks the closing turn for save_note only", () => {
    expect(CLOSE_PROMPT).toContain("`save_note`");
    expect(CLOSE_PROMPT).toContain("do not call `show_choices`");
  });
});
```

Run: `corepack pnpm vitest run packages/shell/test/task-prompts.test.ts`
Expected: FAIL (the module doesn't exist).

- [ ] **Step 2: Implement**

Create `packages/shell/src/main/task-prompts.ts`:
```ts
import type { Language } from "@humanharness/harness-sdk";

const LANGUAGE_NAMES: Record<Language, string> = { es: "Spanish", en: "English" };

/** The first message of a free-question task (a question that isn't one of the harness's actions). */
export const QUESTION_PROMPT = [
  "The person asked a question that is not one of the guided topics. Answer it in {{language}}, reading only what you need, then end with `show_choices`.",
  "",
  "{{notesIndex}}",
  "",
  "## Question",
  "{{question}}",
].join("\n");

/** The fixed core prompt of a task's closing turn. */
export const CLOSE_PROMPT =
  "We are closing this topic. Call the `save_note` tool once with what this conversation made clear: a short title, at most 5 summary points, the decisions taken, the files that back them and the questions left open. Do not write any file yourself and do not call `show_choices`. Then reply with one short sentence.";

/**
 * Fills `{{language}}`, `{{notesIndex}}` and `{{question}}` in one pass (inserted text is never filled
 * again). A brief without `{{notesIndex}}` gets the index appended, so every new session starts with it.
 */
export function fillPrompt(template: string, vars: { language: Language; notesIndex: string; question?: string }): string {
  const values: Record<string, string> = {
    language: LANGUAGE_NAMES[vars.language],
    notesIndex: vars.notesIndex,
    ...(vars.question !== undefined ? { question: vars.question } : {}),
  };
  const hasIndex = /\{\{\s*notesIndex\s*\}\}/.test(template);
  const filled = template
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (all, key: string) => (Object.hasOwn(values, key) ? values[key] : all))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return hasIndex || !vars.notesIndex ? filled : `${filled}\n\n${vars.notesIndex}`;
}
```

- [ ] **Step 3: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/task-prompts.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shell
git commit -m "feat(shell): task prompts (brief filling, free questions, closing turn)"
```

### Task 15: Task manager

**Files:**
- Create: `packages/shell/src/main/task-manager.ts`, `packages/shell/test/task-manager.test.ts`

- [ ] **Step 1: Failing tests**

Create `packages/shell/test/task-manager.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import type { SavedNote } from "@humanharness/harness-sdk";
import type { Event } from "@humanharness/runtime";
import type { TaskView } from "@humanharness/ui/client";
import type { Note, NoteMeta } from "@humanharness/workspace";
import { TaskManager } from "../src/main/task-manager";
import { CLOSE_PROMPT } from "../src/main/task-prompts";
import { type TasksFile, emptyTasks } from "../src/main/task-store";
import type { TurnOptions } from "../src/main/turn-controller";

const label = (en: string, es = en) => ({ es, en });
const note: SavedNote = {
  title: "The manifest",
  summary: ["It declares the harness"],
  decisions: ["Actions carry a brief"],
  files: ["packages/harness-sdk/src/index.ts"],
  open: [],
};
const saveNote = (data: unknown = note): Event => ({ type: "block", name: "save_note", data });
const ok: Event = { type: "done", ok: true };
const cancelled: Event = { type: "done", ok: false, error: { code: "cancelled" } };
const crashed: Event = { type: "done", ok: false, error: { code: "agent-crashed" } };

/** A task manager over memory: each turn plays the next script entry (just `done: ok` when none is left). */
function setup(opts: { script?: Event[][]; state?: TasksFile; path?: string[]; notes?: Note[]; gate?: Promise<void> } = {}) {
  let state = opts.state ?? emptyTasks();
  const notes: Note[] = [...(opts.notes ?? [])];
  const script = [...(opts.script ?? [])];
  const turns: { message: string; options: TurnOptions }[] = [];
  const views: TaskView[] = [];
  const log: string[] = [];
  let busy = false;
  let n = 0;
  const manager = new TaskManager({
    store: {
      load: async () => structuredClone(state),
      save: async (s) => {
        state = structuredClone(s);
      },
    },
    turns: {
      isBusy: () => busy,
      send: async (message, options) => {
        busy = true;
        turns.push({ message, options });
        log.push(`turn:${options.phase ?? "run"}`);
        await opts.gate;
        for (const e of script.shift() ?? [ok]) options.onEvent?.(e);
        busy = false;
      },
    },
    actions: { manifest: { label: label("The manifest", "El manifiesto") }, engines: { label: label("Engines", "Motores") }, turn: { label: label("A turn") } },
    path: opts.path ?? ["manifest", "engines", "turn"],
    readPrompt: async (action) => `# Topic: ${action}\nAnswer in {{language}}.\n\n{{notesIndex}}`,
    language: async () => "en",
    engine: async () => "claude",
    notes: async () => [...notes],
    writeNote: async (slug: string, saved: SavedNote, meta: NoteMeta) => {
      log.push(`note:${slug}`);
      notes.unshift({ slug, path: `.harness/notes/${slug}.md`, ...saved, ...meta });
    },
    endSession: async () => void log.push("endSession"),
    saveHistory: async (message) => void log.push(`history:${message}`),
    changed: (v) => views.push(v),
    now: () => new Date("2026-10-12T11:20:00.000Z"),
    newId: () => `t${++n}`,
  });
  return { manager, turns, views, log, state: () => state };
}

describe("TaskManager", () => {
  it("starts an action in a fresh session: its brief with the notes index is the first message", async () => {
    const engines: Note = {
      slug: "engines",
      path: ".harness/notes/engines.md",
      title: "Engines",
      action: "engines",
      date: "2026-10-11T10:00:00.000Z",
      engine: "codex",
      summary: ["Detected on every start"],
      decisions: [],
      files: [],
      open: [],
    };
    const t = setup({ notes: [engines] });
    await t.manager.start("manifest", "The manifest");
    expect(t.log).toEqual(["endSession", "turn:run"]);
    const [first] = t.turns;
    expect(first.message).toContain("# Topic: manifest\nAnswer in English.");
    expect(first.message).toContain("## What we already covered\n- Engines (engines): Detected on every start → .harness/notes/engines.md");
    expect(first.options).toMatchObject({ action: "manifest", task: "t1", display: "The manifest", phase: "run" });
    expect(t.state()).toMatchObject({ engine: "claude", current: { id: "t1", action: "manifest", status: "waiting", turns: 1 } });
    expect(t.views.at(-1)?.current).toEqual({ id: "t1", action: "manifest", status: "waiting" });
  });

  it("shows an action's label in the configured language when no display text is given", async () => {
    const t = setup();
    await t.manager.start("engines");
    expect(t.turns[0].options.display).toBe("Engines");
  });

  it("sends a typed message as a follow-up of the waiting task", async () => {
    const t = setup();
    await t.manager.start("manifest");
    await t.manager.ask("And the blocks?");
    expect(t.turns[1]).toMatchObject({ message: "And the blocks?", options: { task: "t1", action: "manifest", followUp: true } });
    expect(t.log.filter((l) => l === "endSession")).toHaveLength(1);
    expect(t.state().current).toMatchObject({ status: "waiting", turns: 2 });
  });

  it("starts a free question as its own task", async () => {
    const t = setup();
    await t.manager.ask("Where are chats saved?");
    expect(t.turns[0].message).toContain("## Question\nWhere are chats saved?");
    expect(t.turns[0].options).toMatchObject({ task: "t1", display: "Where are chats saved?" });
    expect(t.turns[0].options.action).toBeUndefined();
    expect(t.state().current).toMatchObject({ id: "t1", status: "waiting", question: "Where are chats saved?" });
  });

  it("on next: closes with a quiet turn, writes the note, then starts the next topic from the index", async () => {
    const t = setup({ script: [[ok], [saveNote(), ok], [ok]] });
    await t.manager.start("manifest");
    await t.manager.choose({ label: "Next topic →", next: true });
    expect(t.turns[1]).toMatchObject({ message: CLOSE_PROMPT, options: { task: "t1", action: "manifest", phase: "close", quiet: true } });
    expect(t.log).toEqual(["endSession", "turn:run", "turn:close", "note:manifest", "history:Note: The manifest", "endSession", "endSession", "turn:run"]);
    expect(t.state().actions).toEqual({ manifest: "done" });
    expect(t.state().current).toMatchObject({ id: "t2", action: "engines", status: "waiting" });
    expect(t.turns[2].message).toContain("- The manifest (manifest): It declares the harness → .harness/notes/manifest.md");
    expect(t.turns[2].options.display).toBe("Engines");
  });

  it("marks the topic unsaved when the closing turn brings no valid note", async () => {
    const t = setup({ script: [[ok], [saveNote({ title: "" }), ok]], path: ["manifest"] });
    await t.manager.start("manifest");
    await t.manager.choose({ label: "Done", next: true });
    expect(t.state()).toMatchObject({ current: null, actions: { manifest: "unsaved" } });
    expect(t.turns).toHaveLength(2);
  });

  it("keeps a follow-up option in the same task, showing its label", async () => {
    const t = setup();
    await t.manager.start("manifest");
    await t.manager.choose({ label: "Go deeper", followUp: "Explain validation in detail." });
    expect(t.turns[1]).toMatchObject({ message: "Explain validation in detail.", options: { task: "t1", display: "Go deeper", followUp: true } });
  });

  it("closes this task and starts the one an option names; an unknown action is a follow-up", async () => {
    const t = setup({ script: [[ok], [saveNote(), ok], [ok]] });
    await t.manager.start("manifest");
    await t.manager.choose({ label: "Compare with a turn", action: "turn" });
    expect(t.state().current).toMatchObject({ id: "t2", action: "turn" });
    expect(t.turns[2].message).toContain("# Topic: turn");
    await t.manager.choose({ label: "Something else", action: "nope" });
    expect(t.turns[3]).toMatchObject({ message: "Something else", options: { task: "t2", followUp: true } });
  });

  it("skips the closing turn when the task already saved its note", async () => {
    const t = setup({ script: [[saveNote(), ok], [ok]] });
    await t.manager.start("manifest");
    await t.manager.choose({ label: "Next", next: true });
    expect(t.turns.map((x) => x.options.phase)).toEqual(["run", "run"]);
    expect(t.state().actions.manifest).toBe("done");
  });

  it("ends the task as unfinished when a turn is cancelled or its first turn fails; a later failure keeps it", async () => {
    const t = setup({ script: [[cancelled]] });
    await t.manager.start("manifest");
    expect(t.state()).toMatchObject({ current: null, actions: { manifest: "unfinished" } });
    expect(t.log.at(-1)).toBe("endSession");

    const u = setup({ script: [[crashed]] });
    await u.manager.start("turn");
    expect(u.state()).toMatchObject({ current: null, actions: { turn: "unfinished" } });

    const v = setup({ script: [[ok], [crashed]] });
    await v.manager.start("engines");
    await v.manager.ask("again?");
    expect(v.state().current).toMatchObject({ action: "engines", status: "waiting" });
  });

  it("interrupt ends the open task without a note, keeping a topic that was already done", async () => {
    const open: TasksFile = {
      ...emptyTasks(),
      actions: { manifest: "done" },
      current: { id: "t9", action: "manifest", status: "waiting", startedAt: "t", turns: 1 },
    };
    const t = setup({ state: open });
    await t.manager.interrupt();
    expect(t.state()).toMatchObject({ current: null, actions: { manifest: "done" } });
    expect(t.log).toEqual(["endSession"]);
    const u = setup({ state: { ...open, actions: {} } });
    await u.manager.interrupt();
    expect(u.state().actions).toEqual({ manifest: "unfinished" });
  });

  it("saves a free question's note under a q- slug", async () => {
    const t = setup({ script: [[ok], [saveNote({ ...note, title: "Where chats live" }), ok]], path: [] });
    await t.manager.ask("Where are chats saved?");
    await t.manager.choose({ label: "Done", next: true });
    expect(t.log).toContain("note:q-where-chats-live");
    expect(t.state()).toMatchObject({ current: null, actions: {} });
  });

  it("refuses a second operation while one runs, and records the session the engine started", async () => {
    let open!: () => void;
    const t = setup({ gate: new Promise<void>((r) => (open = r)) });
    const first = t.manager.start("manifest");
    await expect(t.manager.ask("hi")).rejects.toThrow("A turn is already running");
    expect(t.manager.isBusy()).toBe(true);
    await vi.waitFor(() => expect(t.turns).toHaveLength(1));
    await t.manager.sessionStarted({ id: "s-1", started: true });
    open();
    await first;
    expect(t.state().current?.session).toEqual({ id: "s-1", started: true });
    expect(t.manager.isBusy()).toBe(false);
  });

  it("refuses an unknown action", async () => {
    await expect(setup().manager.start("nope")).rejects.toThrow("Unknown action");
  });

  it("tells the window every change, with the notes", async () => {
    const t = setup({ script: [[ok], [saveNote(), ok]], path: ["manifest"] });
    await t.manager.start("manifest");
    await t.manager.choose({ label: "Done", next: true });
    expect(t.views.map((v) => v.current?.status ?? "idle")).toContain("closing");
    expect(t.views.at(-1)).toEqual({
      current: null,
      actions: { manifest: "done" },
      notes: [
        {
          slug: "manifest",
          title: "The manifest",
          action: "manifest",
          date: "2026-10-12T11:20:00.000Z",
          summary: ["It declares the harness"],
          decisions: ["Actions carry a brief"],
          path: ".harness/notes/manifest.md",
        },
      ],
    });
    expect(await t.manager.view()).toEqual(t.views.at(-1));
  });
});
```

Run: `corepack pnpm vitest run packages/shell/test/task-manager.test.ts`
Expected: FAIL (the module doesn't exist).

- [ ] **Step 2: Implement**

Create `packages/shell/src/main/task-manager.ts`:
```ts
import { randomUUID } from "node:crypto";
import { type ChoiceOption, type Language, type LocalizedText, type SavedNote, saveNoteSchema } from "@humanharness/harness-sdk";
import type { Event, Session } from "@humanharness/runtime";
import { type ActionStatus, type NoteView, type TaskStatus, type TaskView, nextInPath } from "@humanharness/ui/client";
import { type Note, type NoteMeta, buildNotesIndex, noteSlug } from "@humanharness/workspace";
import { CLOSE_PROMPT, QUESTION_PROMPT, fillPrompt } from "./task-prompts";
import type { CurrentTask, TasksFile } from "./task-store";
import type { TurnOptions } from "./turn-controller";

type Done = Extract<Event, { type: "done" }>;

export interface TaskDeps {
  /** tasks.json of the configured folder. */
  store: { load(): Promise<TasksFile>; save(state: TasksFile): Promise<void> };
  turns: { send(message: string, options: TurnOptions): Promise<void>; isBusy(): boolean };
  /** The harness's actions (their labels, by language). */
  actions: Record<string, { label: LocalizedText }>;
  /** The guided path: action ids in order. */
  path: string[];
  /** The text of the action's brief (its prompt file). */
  readPrompt(action: string): Promise<string>;
  language(): Promise<Language>;
  engine(): Promise<string>;
  /** The folder's notes, newest first. */
  notes(): Promise<Note[]>;
  writeNote(slug: string, note: SavedNote, meta: NoteMeta): Promise<void>;
  /** Ends the engine session (Codex: `session/close`); the next turn starts a new one. */
  endSession(): Promise<void>;
  /** Records the folder in the local history (a note was written). */
  saveHistory?(message: string): Promise<void>;
  /** The task view changed: tell the window. */
  changed(view: TaskView): void;
  now?: () => Date;
  newId?: () => string;
}

const noteView = (n: Note): NoteView => ({
  slug: n.slug,
  title: n.title,
  ...(n.action ? { action: n.action } : {}),
  date: n.date,
  summary: n.summary,
  decisions: n.decisions,
  path: n.path,
});

/**
 * The app-driven flow (spec §4.2): one engine session per task. idle → running → waiting; a message
 * while waiting follows up in the same session; picking "next" or another topic closes the task with
 * one quiet turn asking for `save_note`, writes the note and starts the next task in a fresh session
 * whose first message carries the notes index. Cancel, a failed first turn and interruptions end the
 * task as unfinished.
 */
export class TaskManager {
  /** Task operations (each may run several turns), one after another. */
  private ops: Promise<unknown> = Promise.resolve();
  /** Changes to tasks.json, one after another. */
  private writes: Promise<unknown> = Promise.resolve();
  private running = false;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(private readonly d: TaskDeps) {
    this.now = d.now ?? (() => new Date());
    this.newId = d.newId ?? randomUUID;
  }

  /** A task operation or a turn is under way. */
  isBusy(): boolean {
    return this.running || this.d.turns.isBusy();
  }

  /** Resolves once the running task operation, if any, has finished. */
  async idle(): Promise<void> {
    await this.ops.catch(() => undefined);
  }

  async view(): Promise<TaskView> {
    const [state, notes] = await Promise.all([this.d.store.load(), this.d.notes().catch(() => [] as Note[])]);
    const c = state.current;
    return {
      current: c ? { id: c.id, ...(c.action ? { action: c.action } : {}), status: c.status } : null,
      actions: state.actions,
      notes: notes.map(noteView),
    };
  }

  /** Starts a manifest action as a new task, closing the current one first. `display` is what the chat shows. */
  start(action: string, display?: string): Promise<void> {
    return this.op(() => this.startNow(action, display));
  }

  /** A message from the person: a follow-up of the waiting task, or a new free-question task. */
  ask(text: string, display?: string): Promise<void> {
    return this.op(() => this.askNow(text, display));
  }

  /** An option of a `choices` block. */
  choose(option: ChoiceOption): Promise<void> {
    return this.op(() => this.chooseNow(option));
  }

  /** Ends the open task without a note (engine change, quit, dropped runtime, a task left by an earlier run). */
  interrupt(): Promise<void> {
    return this.queue(async () => {
      const c = (await this.d.store.load()).current;
      if (c) await this.endTask(c.id, "unfinished");
    });
  }

  /** The engine started the current task's session. */
  sessionStarted(session: Session): Promise<void> {
    return this.update((s) => (s.current ? { ...s, current: { ...s.current, session: { id: session.id, started: session.started } } } : s));
  }

  private op(fn: () => Promise<void>): Promise<void> {
    if (this.isBusy()) return Promise.reject(new Error("A turn is already running"));
    this.running = true;
    return this.queue(fn).finally(() => {
      this.running = false;
    });
  }

  private queue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.ops.then(fn, fn);
    this.ops = run.catch(() => undefined);
    return run;
  }

  private known(action: string | undefined): action is string {
    return action !== undefined && Object.hasOwn(this.d.actions, action);
  }

  private async startNow(action: string, display?: string): Promise<void> {
    if (!this.known(action)) throw new Error("Unknown action");
    await this.closeCurrent();
    const template = await this.d.readPrompt(action);
    const language = await this.d.language();
    await this.begin({ action }, (notesIndex) => fillPrompt(template, { language, notesIndex }), display ?? this.d.actions[action].label[language]);
  }

  private async askNow(text: string, display?: string): Promise<void> {
    const c = (await this.d.store.load()).current;
    if (c?.status === "waiting") {
      await this.setStatus(c.id, "running");
      const done = await this.runTurn(c, text, { ...(display ? { display } : {}), ...(c.action ? { action: c.action } : {}), followUp: true });
      return this.afterRun(c.id, done, false);
    }
    if (c) await this.endTask(c.id, "unfinished");
    const language = await this.d.language();
    await this.begin(
      { question: text.slice(0, 500) },
      (notesIndex) => fillPrompt(QUESTION_PROMPT, { language, notesIndex, question: text }),
      display ?? text,
    );
  }

  private async chooseNow(option: ChoiceOption): Promise<void> {
    const state = await this.d.store.load();
    const action = this.known(option.action) ? option.action : undefined;
    if (!option.next && !action) return this.askNow(option.followUp ?? option.label, option.label);
    const target = option.next ? nextInPath(this.d.path, state.current?.action, state.actions) : action;
    await this.closeCurrent();
    if (target) await this.startNow(target);
  }

  /** A new task in a fresh session; its first message is built from the notes index. */
  private async begin(task: { action?: string; question?: string }, message: (notesIndex: string) => string, display: string): Promise<void> {
    await this.endSession();
    const notes = await this.d.notes().catch(() => [] as Note[]);
    const engine = await this.d.engine();
    const current: CurrentTask = { id: this.newId(), ...task, status: "running", startedAt: this.now().toISOString(), turns: 0 };
    await this.update((s) => ({ ...s, engine, current }));
    const done = await this.runTurn(current, message(buildNotesIndex(notes)), { display, ...(task.action ? { action: task.action } : {}) });
    await this.afterRun(current.id, done, true);
  }

  /** Runs one turn of `task`; a valid `save_note` in it becomes the task's note. */
  private async runTurn(task: CurrentTask, message: string, options: Omit<TurnOptions, "task" | "onEvent">): Promise<Done> {
    const seen: { done?: Done; note?: SavedNote } = {};
    try {
      await this.d.turns.send(message, {
        phase: "run",
        ...options,
        task: task.id,
        onEvent: (e) => {
          if (e.type === "done") seen.done = e;
          else if (e.type === "block" && e.name === "save_note") {
            const parsed = saveNoteSchema.safeParse(e.data);
            if (parsed.success) seen.note = parsed.data;
          }
        },
      });
    } catch (err) {
      // The turn never started (another one runs, or the app is closing).
      seen.done ??= { type: "done", ok: false, error: { code: "agent-crashed", detail: err instanceof Error ? err.message : String(err) } };
    }
    if (seen.note) await this.saveNote(task, seen.note);
    return seen.done ?? { type: "done", ok: false, error: { code: "agent-crashed" } };
  }

  private async afterRun(id: string, done: Done, first: boolean): Promise<void> {
    if (!done.ok && (done.error.code === "cancelled" || first)) return this.endTask(id, "unfinished");
    await this.update((s) => (s.current?.id === id ? { ...s, current: { ...s.current, status: "waiting", turns: s.current.turns + 1 } } : s));
  }

  /** Closes the open task: one quiet turn asking for `save_note`, unless its note is already written. */
  private async closeCurrent(): Promise<void> {
    const c = (await this.d.store.load()).current;
    if (!c) return;
    if (c.noteSaved) return this.endTask(c.id, "done");
    if (c.status !== "waiting") return this.endTask(c.id, "unfinished");
    await this.setStatus(c.id, "closing");
    const done = await this.runTurn(c, CLOSE_PROMPT, { ...(c.action ? { action: c.action } : {}), phase: "close", quiet: true });
    const saved = (await this.d.store.load()).current?.noteSaved === true;
    await this.endTask(c.id, saved ? "done" : !done.ok && done.error.code === "cancelled" ? "unfinished" : "unsaved");
  }

  private async endTask(id: string, outcome: ActionStatus): Promise<void> {
    await this.update((s) => {
      const c = s.current;
      if (!c || c.id !== id) return s;
      if (!c.action) return { ...s, current: null };
      const status: ActionStatus = c.noteSaved || (outcome !== "done" && s.actions[c.action] === "done") ? "done" : outcome;
      return { ...s, current: null, actions: { ...s.actions, [c.action]: status } };
    });
    await this.endSession();
  }

  private async saveNote(task: CurrentTask, note: SavedNote): Promise<void> {
    try {
      const slug = task.action ?? `q-${noteSlug(note.title)}`;
      await this.d.writeNote(slug, note, { ...(task.action ? { action: task.action } : {}), date: this.now().toISOString(), engine: await this.d.engine() });
      await this.update((s) => (s.current?.id === task.id ? { ...s, current: { ...s.current, noteSaved: true } } : s));
      await this.d.saveHistory?.(`Note: ${note.title.slice(0, 60)}`);
    } catch (err) {
      console.error("Could not save the note", err);
    }
  }

  private setStatus(id: string, status: TaskStatus): Promise<void> {
    return this.update((s) => (s.current?.id === id ? { ...s, current: { ...s.current, status } } : s));
  }

  private async endSession(): Promise<void> {
    try {
      await this.d.endSession();
    } catch (err) {
      console.error("Could not end the engine session", err);
    }
  }

  /** Reads tasks.json, applies `fn`, saves it when it changed and tells the window. */
  private update(fn: (s: TasksFile) => TasksFile): Promise<void> {
    const run = this.writes.then(async () => {
      const before = await this.d.store.load();
      const after = fn(before);
      if (after === before) return;
      await this.d.store.save(after);
      try {
        this.d.changed(await this.view());
      } catch (err) {
        console.error("Could not send the tasks to the window", err);
      }
    });
    this.writes = run.catch(() => undefined);
    return run;
  }
}
```

- [ ] **Step 3: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/task-manager.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shell
git commit -m "feat(shell): task manager — one engine session per task, closing turn, notes"
```

### Task 16: Reference folders, safe file opening, test hooks

**Files:**
- Create: `packages/shell/src/main/references.ts`, `packages/shell/src/main/open-path.ts`, `packages/shell/src/main/test-hooks.ts`
- Create: `packages/shell/test/references.test.ts`, `packages/shell/test/open-path.test.ts`, `packages/shell/test/test-hooks.test.ts`

- [ ] **Step 1: Failing tests**

Create `packages/shell/test/references.test.ts`:
```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { appSourceDir, displayPath, referenceAllowed, resolveReferences } from "../src/main/references";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hh-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const label = { es: "Código", en: "Source" };
const repo = path.join(root, "repo");
fs.mkdirSync(path.join(repo, "harnesses", "demo"), { recursive: true });
fs.writeFileSync(path.join(repo, "pnpm-workspace.yaml"), "packages: []\n");
const home = path.join(root, "home");
fs.mkdirSync(path.join(home, "code", "docs"), { recursive: true });
const allowAll = { allowed: () => true };

describe("appSourceDir", () => {
  it("walks up from the harness folder to the workspace root", async () => {
    expect(await appSourceDir(path.join(repo, "harnesses", "demo"))).toBe(repo);
    expect(await appSourceDir(path.join(root, "home"))).toBeNull();
  });
});

describe("resolveReferences", () => {
  it("resolves app-source in development and ~/ paths; drops what is missing or packaged", async () => {
    const refs = [
      { id: "source", label, default: "app-source" },
      { id: "docs", label, default: "~/code/docs" },
      { id: "gone", label, default: "~/nowhere" },
    ];
    const dev = await resolveReferences(refs, { harnessDir: path.join(repo, "harnesses", "demo"), home, packaged: false, ...allowAll });
    expect(dev).toEqual([
      { id: "source", label, path: repo },
      { id: "docs", label, path: path.join(home, "code", "docs") },
    ]);
    const packaged = await resolveReferences(refs, { harnessDir: path.join(repo, "harnesses", "demo"), home, packaged: true, ...allowAll });
    expect(packaged.map((r) => r.id)).toEqual(["docs"]);
  });

  it("refuses folders the agent must never read, by default", async () => {
    const refs = [{ id: "x", label, default: "~/code/docs" }];
    const refused = await resolveReferences(refs, { harnessDir: repo, home, packaged: false, allowed: () => false });
    expect(refused).toEqual([]);
  });
});

describe("referenceAllowed", () => {
  it("allows a project folder and refuses credentials, system folders and the whole home", () => {
    expect(referenceAllowed("/Users/me/code/humanharness", "/Users/me")).toBe(true);
    expect(referenceAllowed("/Users/me/.claude", "/Users/me")).toBe(false);
    expect(referenceAllowed("/Users/me/.codex/sessions", "/Users/me")).toBe(false);
    expect(referenceAllowed("/Users/me", "/Users/me")).toBe(false);
    expect(referenceAllowed("/etc", "/Users/me")).toBe(false);
    expect(referenceAllowed("/Users/me/code/a,b", "/Users/me")).toBe(false);
  });
});

describe("displayPath", () => {
  it("shortens paths in the home folder", () => {
    expect(displayPath("/Users/me/code/hh", "/Users/me")).toBe("~/code/hh");
    expect(displayPath("/opt/x", "/Users/me")).toBe("/opt/x");
  });
});
```

Create `packages/shell/test/open-path.test.ts`:
```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openableFile } from "../src/main/open-path";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hh-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const ref = path.join(root, "ref");
const folder = path.join(root, "work");
const outside = path.join(root, "outside");
for (const d of [path.join(ref, "packages"), path.join(folder, ".harness", "notes"), outside]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(ref, "packages", "a.ts"), "x");
fs.writeFileSync(path.join(folder, ".harness", "notes", "turn.md"), "x");
fs.writeFileSync(path.join(outside, "secret.md"), "x");
fs.writeFileSync(path.join(ref, "run.command"), "x");
fs.symlinkSync(path.join(outside, "secret.md"), path.join(ref, "link.md"));

describe("openableFile", () => {
  const roots = [ref, folder];
  it("finds a file in the first root that has it", async () => {
    expect(await openableFile("packages/a.ts", roots)).toBe(path.join(ref, "packages", "a.ts"));
    expect(await openableFile(".harness/notes/turn.md", roots)).toBe(path.join(folder, ".harness", "notes", "turn.md"));
  });

  it("refuses escapes, links that point outside, folders, programs and junk", async () => {
    expect(await openableFile("../outside/secret.md", roots)).toBeNull();
    expect(await openableFile(path.join(outside, "secret.md"), roots)).toBeNull();
    expect(await openableFile("link.md", roots)).toBeNull();
    expect(await openableFile("packages", roots)).toBeNull();
    expect(await openableFile("run.command", roots)).toBeNull();
    expect(await openableFile("missing.md", roots)).toBeNull();
    expect(await openableFile(42, roots)).toBeNull();
    expect(await openableFile("a\0b.md", roots)).toBeNull();
  });
});
```

Create `packages/shell/test/test-hooks.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import { readTestHooks, testEngineStatus } from "../src/main/test-hooks";

const engines = JSON.stringify({
  claude: { command: ["/usr/local/bin/node", "fake-claude.ts"], env: { HH_FAKE_SCRIPT: "/s.json", ANTHROPIC_API_KEY: "x", HOME: "/x" } },
  codex: { command: [], env: {} },
  bad: "nope",
});

describe("readTestHooks", () => {
  it("is empty in a packaged app", () => {
    expect(readTestHooks({ HH_TEST_USER_DATA: "/u", HH_TEST_ENGINES: engines }, true)).toEqual({});
  });

  it("reads absolute folders and fake engines in development, passing only HH_FAKE_* variables", () => {
    expect(readTestHooks({ HH_TEST_USER_DATA: "/u", HH_TEST_SHARED_DIR: "/s", HH_TEST_ENGINES: engines }, false)).toEqual({
      userData: "/u",
      sharedDir: "/s",
      engines: { claude: { command: ["/usr/local/bin/node", "fake-claude.ts"], env: { HH_FAKE_SCRIPT: "/s.json" } } },
    });
  });

  it("ignores relative folders and broken engine lists", () => {
    expect(readTestHooks({ HH_TEST_USER_DATA: "u", HH_TEST_ENGINES: "{broken" }, false)).toEqual({});
  });
});

describe("testEngineStatus", () => {
  it("reports a fake engine as installed, signed in and tested", () => {
    expect(testEngineStatus(getEngine("claude"), true)).toEqual({
      engineId: "claude",
      installed: true,
      version: getEngine("claude").detect.minVersion,
      minVersion: getEngine("claude").detect.minVersion,
      outdated: false,
      loggedIn: true,
      noticeAccepted: true,
      verified: true,
    });
    expect(testEngineStatus(getEngine("codex"), false).noticeAccepted).toBe(false);
  });
});
```

Run: `corepack pnpm vitest run packages/shell/test/references.test.ts packages/shell/test/open-path.test.ts packages/shell/test/test-hooks.test.ts`
Expected: FAIL (the modules don't exist).

- [ ] **Step 2: Reference folders**

Create `packages/shell/src/main/references.ts`:
```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import type { HarnessReference, LocalizedText } from "@humanharness/harness-sdk";
import { folderProblem } from "./validate";

export interface ResolvedReference {
  id: string;
  label: LocalizedText;
  /** Absolute real path. */
  path: string;
}

const exists = (p: string) => fs.access(p).then(() => true, () => false);

/** The repository the app runs from: the nearest folder above the harness with a pnpm-workspace.yaml. */
export async function appSourceDir(harnessDir: string): Promise<string | null> {
  let dir = path.resolve(harnessDir);
  for (;;) {
    if (await exists(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Whether the agent may read `dir`: never credentials (~/.claude, ~/.codex), ~/Library, system folders,
 * the whole home or a standard home folder as a whole. A comma would break Claude's tool lists.
 */
export function referenceAllowed(dir: string, home: string): boolean {
  return !dir.includes(",") && folderProblem(dir, home) === null;
}

/** "~/…" for a path inside the home folder. */
export function displayPath(p: string, home: string): string {
  return p === home || p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p;
}

/** The manifest's reference folders that exist and may be read; "app-source" only in development. */
export async function resolveReferences(
  refs: HarnessReference[],
  opts: { harnessDir: string; home: string; packaged: boolean; allowed?: (dir: string) => boolean },
): Promise<ResolvedReference[]> {
  const allowed = opts.allowed ?? ((dir: string) => referenceAllowed(dir, opts.home));
  const out: ResolvedReference[] = [];
  for (const r of refs) {
    let dir: string | null;
    if (r.default === "app-source") dir = opts.packaged ? null : await appSourceDir(opts.harnessDir);
    else dir = r.default.startsWith("~/") ? path.join(opts.home, r.default.slice(2)) : r.default;
    if (!dir || !path.isAbsolute(dir)) continue;
    try {
      const real = await fs.realpath(dir);
      if ((await fs.stat(real)).isDirectory() && allowed(real)) out.push({ id: r.id, label: r.label, path: real });
    } catch {
      // missing: left out
    }
  }
  return out;
}
```

- [ ] **Step 3: Safe file opening**

Create `packages/shell/src/main/open-path.ts`:
```ts
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Files "Open" may hand to the system: text, data and images. Never apps, scripts or installers
 * (`.app`, `.command`, `.sh`, `.pkg`…), which the system would run instead of showing.
 */
const OPENABLE = new Set([
  ".md", ".txt", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".csv",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".html",
  ".svg", ".png", ".jpg", ".jpeg", ".gif", ".pdf",
]);

/**
 * The real path of `rel` inside one of `roots` (tried in order): a regular file with an openable
 * extension, symlinks resolved. Null when it is missing, escapes every root, or isn't openable.
 */
export async function openableFile(rel: unknown, roots: string[]): Promise<string | null> {
  if (typeof rel !== "string" || !rel || rel.length > 1000 || rel.includes("\0")) return null;
  for (const root of roots) {
    let realRoot: string;
    let real: string;
    try {
      realRoot = await fs.realpath(root);
      real = await fs.realpath(path.resolve(realRoot, rel));
    } catch {
      continue;
    }
    if (!real.startsWith(realRoot + path.sep)) continue;
    if (!OPENABLE.has(path.extname(real).toLowerCase())) continue;
    const stat = await fs.stat(real).catch(() => null);
    if (stat?.isFile()) return real;
  }
  return null;
}
```

- [ ] **Step 4: Test hooks**

Create `packages/shell/src/main/test-hooks.ts`:
```ts
import path from "node:path";
import type { EngineDef } from "@humanharness/engines";
import type { EngineStatus } from "@humanharness/ui/client";

/** A fake engine for the end-to-end tests: the command to run instead of the real CLI. */
export interface TestEngine {
  command: string[];
  /** Only HH_FAKE_* variables (the fake agents' scripts and logs). */
  env: Record<string, string>;
}

export interface TestHooks {
  userData?: string;
  sharedDir?: string;
  engines?: Record<string, TestEngine>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * End-to-end test settings from the environment: HH_TEST_USER_DATA, HH_TEST_SHARED_DIR and
 * HH_TEST_ENGINES (JSON: engine id → { command, env }). Development builds only: a packaged app
 * ignores them. Engine environments keep only HH_FAKE_* variables, so no credential or auth variable
 * can be passed this way.
 */
export function readTestHooks(env: Record<string, string | undefined>, packaged: boolean): TestHooks {
  if (packaged) return {};
  const hooks: TestHooks = {};
  const dir = (v: string | undefined) => (v && path.isAbsolute(v) ? v : undefined);
  const userData = dir(env.HH_TEST_USER_DATA);
  const sharedDir = dir(env.HH_TEST_SHARED_DIR);
  if (userData) hooks.userData = userData;
  if (sharedDir) hooks.sharedDir = sharedDir;
  let raw: unknown;
  try {
    raw = env.HH_TEST_ENGINES ? JSON.parse(env.HH_TEST_ENGINES) : undefined;
  } catch {
    raw = undefined;
  }
  if (isObject(raw)) {
    const engines: Record<string, TestEngine> = {};
    for (const [id, e] of Object.entries(raw)) {
      if (!isObject(e) || !Array.isArray(e.command) || e.command.length === 0 || !e.command.every((c) => typeof c === "string")) continue;
      const fakeEnv = Object.fromEntries(
        Object.entries(isObject(e.env) ? e.env : {}).filter(([k, v]) => k.startsWith("HH_FAKE_") && typeof v === "string"),
      ) as Record<string, string>;
      engines[id] = { command: e.command as string[], env: fakeEnv };
    }
    if (Object.keys(engines).length > 0) hooks.engines = engines;
  }
  return hooks;
}

/** A fake engine is always installed, signed in and tested; only the legal notice is real. */
export function testEngineStatus(engine: EngineDef, noticeAccepted: boolean): EngineStatus {
  return {
    engineId: engine.id,
    installed: true,
    version: engine.detect.minVersion,
    minVersion: engine.detect.minVersion,
    outdated: false,
    loggedIn: true,
    noticeAccepted,
    verified: true,
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/shell`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shell
git commit -m "feat(shell): reference folders, safe file opening, development test hooks"
```

### Task 17: Wire the main process

No unit test (Electron main); the E2E tests in Task 24 drive it. Each step below names exact code in `packages/shell/src/main/index.ts`.

**Files:**
- Modify: `packages/shell/src/main/index.ts`

- [ ] **Step 1: Imports and hooks**

Replace the harness-sdk import with:
```ts
import { type LoadedHarness, allBlocks, choiceOptionSchema, loadHarness, resolveInHarness } from "@humanharness/harness-sdk";
```
replace the workspace import with:
```ts
import { History, NOTES_PREFIX, readNotes, writeNote } from "@humanharness/workspace";
```
and add after the `./validate` import:
```ts
import { openableFile } from "./open-path";
import { type ResolvedReference, displayPath, resolveReferences } from "./references";
import { TaskManager } from "./task-manager";
import { TaskStore, emptyTasks } from "./task-store";
import { readTestHooks, testEngineStatus } from "./test-hooks";
```
Add after `const logos = new Map<string, Promise<string | null>>();`:
```ts
/** End-to-end test settings (development builds only; see test-hooks.ts). */
const hooks = readTestHooks(process.env, app.isPackaged);
/** The manifest's reference folders on this machine, resolved once the app is ready. */
let references: Promise<ResolvedReference[]> = Promise.resolve([]);
```
Replace the `stateBlocks` line with:
```ts
const stateBlocks = () => new Set(Object.entries(allBlocks(harness)).filter(([, b]) => !b.visible).map(([n]) => n));
```

- [ ] **Step 2: App state**

In `appState()`, replace `actions: harness.actions,` with:
```ts
    // What the screen needs of each action (never the prompt file).
    actions: Object.fromEntries(
      Object.entries(harness.actions).map(([id, a]) => [id, { label: a.label, cost: a.cost, ...(a.description ? { description: a.description } : {}) }]),
    ),
    path: harness.path ?? [],
    references: (await references).map((r) => ({ id: r.id, label: r.label, path: displayPath(r.path, os.homedir()) })),
```

- [ ] **Step 3: Runtime: fake engines, references, sessions**

Replace the body of the `runtime` memoise, from `const engine = getEngine(c.engineId);` to the end of the `createRuntime({ … })` call, with:
```ts
  const engine = getEngine(c.engineId);
  let cmd: { command: string[]; env: Record<string, string> } | null;
  const fake = hooks.engines?.[engine.id];
  if (fake) cmd = fake;
  else {
    // Spec §9 "every start": enforce detect.minVersion and a signed-in CLI before the first turn.
    const status = await detectEngine(engine, commandDeps, shared);
    if (!status.installed) return null;
    if (status.outdated) throw new EngineUnavailable("outdated-version");
    if (status.loggedIn === false) throw new EngineUnavailable("session-expired");
    cmd = await engineCommand(engine, commandDeps);
  }
  if (!cmd) return null;
  return createRuntime({
    harness,
    engine,
    folder: c.folder,
    gitdir: historyDir(app.getPath("userData"), c.folder),
    language: c.language,
    launcher: electronLauncher(process.execPath),
    uiServerEntry: path.join(__dirname, "ui-server.js"),
    command: cmd.command,
    env: cmd.env,
    references: (await references).map((r) => ({ label: r.label[c.language], path: r.path })),
    onSession: (s) => void tasks.sessionStarted(s).catch((err: unknown) => console.error("Could not record the session", err)),
  });
```
Replace `dropRuntime` with:
```ts
/** Ends the open task, then closes the running runtime (e.g. the engine changed); the next turn starts a new one. */
async function dropRuntime() {
  await tasks.interrupt().catch((err: unknown) => console.error("Could not end the task", err));
  const rt = await runtime.peek()?.catch(() => null);
  runtime.clear();
  await rt?.close();
}
```
In `currentHistory`, replace the `new History(…)` line with:
```ts
  const history = new History(c.folder, historyDir(app.getPath("userData"), c.folder), [".harness/", "AGENTS.md", ...(extra ? [extra] : [])], [NOTES_PREFIX]);
```

- [ ] **Step 4: The task manager**

Add after the `turns` declaration:
```ts
const tasks = new TaskManager({
  store: {
    load: async () => {
      const c = await validConfig();
      return c ? new TaskStore(c.folder).load() : emptyTasks();
    },
    save: async (state) => {
      const c = await validConfig();
      if (c) await new TaskStore(c.folder).save(state);
    },
  },
  turns,
  actions: harness.actions,
  path: harness.path ?? [],
  readPrompt: (action) => fs.readFile(resolveInHarness(harness, harness.actions[action].prompt), "utf8"),
  language: async () => (await config.load()).language ?? harness.languages[0],
  engine: async () => (await config.load()).engineId ?? "",
  notes: async () => {
    const c = await validConfig();
    return c ? readNotes(c.folder) : [];
  },
  writeNote: async (slug, note, meta) => {
    const c = await validConfig();
    if (!c) throw new Error("The app is not set up yet");
    await writeNote(c.folder, slug, note, meta);
  },
  endSession: async () => {
    const rt = await runtime.peek()?.catch(() => null);
    await rt?.endSession();
  },
  saveHistory: async (message) => {
    await (await currentHistory())?.save(message);
  },
  changed: (view) => sendToWindow("hh:tasks", view),
});
```
(`harness` is assigned before `whenReady`, and `tasks` only reads it when a task starts.)

- [ ] **Step 5: IPC**

In `registerIpc`:

- In `hh:saveConfig`, replace `isBusy: () => turns.isBusy(),` with `isBusy: () => tasks.isBusy(),` and `idle: () => turns.flush(),` with:
```ts
          idle: async () => {
            await tasks.idle();
            await turns.flush();
          },
```
- In `hh:loadChat`, replace `turns.isBusy()` with `tasks.isBusy()`.
- In `hh:restore`, replace both `turns.isBusy()` with `tasks.isBusy()`.
- In `hh:runSetup`, replace `isBusy: () => turns.isBusy(),` with `isBusy: () => tasks.isBusy(),`.
- Replace the `hh:send` handler with:
```ts
  handle("hh:send", (message: string, options?: SendOptions) => {
    const blocked = guards.turnBlocked();
    if (blocked) throw new Error(blocked);
    if (typeof message !== "string" || !message.trim() || message.length > 20_000) throw new Error("Invalid message");
    const action = typeof options?.action === "string" && Object.hasOwn(harness.actions, options.action) ? options.action : undefined;
    // A message with an action starts that task (the message is what the chat shows); any other follows up or asks.
    return action ? tasks.start(action, message) : tasks.ask(message);
  });
  handle("hh:getTasks", () => tasks.view());
  handle("hh:choose", (option: unknown) => {
    const blocked = guards.turnBlocked();
    if (blocked) throw new Error(blocked);
    const parsed = choiceOptionSchema.safeParse(option);
    if (!parsed.success) throw new Error("Invalid choice");
    return tasks.choose(parsed.data);
  });
  handle("hh:openPath", async (file: unknown) => {
    const c = await validConfig();
    if (!c) return false;
    const target = await openableFile(file, [...(await references).map((r) => r.path), c.folder]);
    if (!target) return false;
    // shell.openPath answers "" on success and an error message otherwise.
    return (await shell.openPath(target)) === "";
  });
```
- Replace the `hh:engineStatus` handler with:
```ts
  handle("hh:engineStatus", async (engineId: string) => {
    const engine = engineFor(engineId);
    if (hooks.engines?.[engine.id]) return testEngineStatus(engine, await hasNotice(engine.id));
    return detectEngine(engine, commandDeps, shared);
  });
```

- [ ] **Step 6: Startup**

Replace `app.setPath("userData", path.join(app.getPath("appData"), "Human Harness", harness.id));` with:
```ts
  app.setPath("userData", hooks.userData ?? path.join(app.getPath("appData"), "Human Harness", harness.id));
```
In the `whenReady` callback, replace `shared = new SharedConfigStore(sharedConfigDir());` with:
```ts
    shared = new SharedConfigStore(hooks.sharedDir ?? sharedConfigDir());
    references = resolveReferences(harness.folder.references, { harnessDir: __HARNESS_DIR__, home: os.homedir(), packaged: app.isPackaged });
```
and add after `registerIpc();`:
```ts
    // A task left open by an earlier run can't continue: its session is gone.
    void tasks.interrupt().catch((err: unknown) => console.error("Could not settle the last task", err));
```

- [ ] **Step 7: Check**

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

Run: `corepack pnpm app:build`
Expected: electron-vite builds `packages/shell/out/main/index.js`, `out/preload/index.mjs` and the renderer without errors.

- [ ] **Step 8: Commit**

```bash
git add packages/shell
git commit -m "feat(shell): drive turns through the task manager; open files; reference folders; test hooks"
```

---

## Phase 5 — UI

### Task 18: Strings and icons

**Files:**
- Modify: `packages/i18n/src/locales/es.json`, `packages/i18n/src/locales/en.json`, `packages/ui/src/chrome.tsx`
- Test: `packages/i18n/test/i18n.test.ts`, `packages/ui/test/chrome.test.tsx`

- [ ] **Step 1: Failing tests**

Append inside `describe("createI18n")` in `packages/i18n/test/i18n.test.ts`:
```ts
  it("has the flow, choices and notes strings, with plural key points", async () => {
    const es = await createI18n("es");
    expect(es.t("flow.path")).toBe("Recorrido");
    expect(es.t("flow.covered")).toBe("Lo que ya quedó claro");
    expect(es.t("flow.readOnly")).toBe("Solo lectura: la IA no cambia nada acá");
    expect(es.t("choices.title")).toBe("¿Cómo seguimos?");
    expect(es.t("notes.resume")).toBe("Retomar este tema");
    expect(es.t("notes.open")).toBe("Abrir el archivo");
    expect(es.t("notes.keyPoints", { count: 1 })).toBe("1 idea clave");
    expect(es.t("notes.keyPoints", { count: 4 })).toBe("4 ideas clave");
    expect(es.t("notes.resumeQuestion", { title: "Motores" })).toBe("Retomemos el tema «Motores».");
    const en = await createI18n("en");
    expect(en.t("notes.keyPoints", { count: 2 })).toBe("2 key points");
    expect(en.t("notes.savings")).toBe("The next question starts from your summaries instead of re-reading the code.");
    expect(en.t("notes.resumeQuestion", { title: "Engines" })).toBe('Let\'s pick up "Engines" again.');
  });

  it("never states token savings as numbers (spec §5.3)", () => {
    for (const language of ["es", "en"] as const) {
      expect(JSON.stringify(CORE_LOCALES[language].notes)).not.toMatch(/token|\d\s?k\b/i);
    }
  });
```

Append inside `describe("chrome")` in `packages/ui/test/chrome.test.tsx` (and add `CheckIcon, LockIcon, NoteIcon` to its import from `"../src/chrome"`):
```ts
  it("draws decorative icons hidden from screen readers", () => {
    const { container } = render(
      <>
        <CheckIcon />
        <LockIcon />
        <NoteIcon />
      </>,
    );
    const icons = container.querySelectorAll("svg");
    expect(icons).toHaveLength(3);
    for (const icon of icons) expect(icon.getAttribute("aria-hidden")).toBe("true");
  });
```

Run: `corepack pnpm vitest run packages/i18n packages/ui/test/chrome.test.tsx`
Expected: FAIL (missing keys and icons).

- [ ] **Step 2: Strings**

In `packages/i18n/src/locales/en.json`, add after the `"chat"` object:
```json
  "flow": {
    "path": "Guided path",
    "covered": "What's clear so far",
    "readOnly": "Read only: the AI doesn't change anything here",
    "startTitle": "Where do we start?",
    "startIntro": "Pick a topic, or ask a question below.",
    "faq": "Frequent questions",
    "seen": "Done",
    "nextUp": "Next on the path",
    "unfinished": "Unfinished",
    "unsaved": "No summary",
    "closing": "Saving what's clear…",
    "backToTopics": "See the topics",
    "placeholderStart": "Or ask something…",
    "placeholderTask": "Ask about this topic…"
  },
  "choices": {
    "title": "How do we continue?"
  },
  "notes": {
    "title": "What's clear so far",
    "close": "Close",
    "resume": "Pick this topic up again",
    "open": "Open the file",
    "openFailed": "I couldn't open that file.",
    "keyPoints_one": "{{count}} key point",
    "keyPoints_other": "{{count}} key points",
    "empty": "No summaries yet. Each topic you close leaves one here.",
    "savings": "The next question starts from your summaries instead of re-reading the code.",
    "footer": "Each topic you finish is summarized in .harness/notes/ inside your folder, so it stays when you change engines or come back another day.",
    "resumeQuestion": "Let's pick up \"{{title}}\" again."
  },
```
In `packages/i18n/src/locales/es.json`, add after the `"chat"` object:
```json
  "flow": {
    "path": "Recorrido",
    "covered": "Lo que ya quedó claro",
    "readOnly": "Solo lectura: la IA no cambia nada acá",
    "startTitle": "¿Por dónde empezamos?",
    "startIntro": "Elegí un tema, o escribí una pregunta abajo.",
    "faq": "Preguntas frecuentes",
    "seen": "Visto",
    "nextUp": "Sigue en el recorrido",
    "unfinished": "Sin terminar",
    "unsaved": "Sin resumen",
    "closing": "Guardando lo que quedó claro…",
    "backToTopics": "Ver los temas",
    "placeholderStart": "O preguntá algo…",
    "placeholderTask": "Preguntá sobre este tema…"
  },
  "choices": {
    "title": "¿Cómo seguimos?"
  },
  "notes": {
    "title": "Lo que quedó claro",
    "close": "Cerrar",
    "resume": "Retomar este tema",
    "open": "Abrir el archivo",
    "openFailed": "No pude abrir ese archivo.",
    "keyPoints_one": "{{count}} idea clave",
    "keyPoints_other": "{{count}} ideas clave",
    "empty": "Todavía no hay resúmenes. Cada tema que cierres deja uno acá.",
    "savings": "La próxima pregunta arranca desde tus resúmenes, sin volver a leer el código.",
    "footer": "Cada tema que terminás queda resumido en .harness/notes/ dentro de tu carpeta. Si cambiás de motor o volvés otro día, no se pierde.",
    "resumeQuestion": "Retomemos el tema «{{title}}»."
  },
```

- [ ] **Step 3: Icons**

Append to `packages/ui/src/chrome.tsx`:
```tsx
/** A done step or topic. */
export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

/** A read-only folder. */
export function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** A saved note. */
export function NoteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M5 4h11l3 3v13H5z" />
    </svg>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/i18n packages/ui`
Expected: PASS (es and en still have the same keys).

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n packages/ui
git commit -m "feat(ui): strings and icons for the flow, choices and notes"
```

### Task 19: `choices` block, side panel and start view

**Files:**
- Create: `packages/ui/src/ChoicesBlock.tsx`, `packages/ui/src/FlowSide.tsx`, `packages/ui/src/StartView.tsx`
- Create: `packages/ui/test/choices.test.tsx`, `packages/ui/test/flow-parts.test.tsx`
- Modify: `packages/ui/src/styles.css`

- [ ] **Step 1: Failing tests**

Create `packages/ui/test/choices.test.tsx`:
```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChoicesBlock, readOptions } from "../src/ChoicesBlock";
import { renderIn } from "./render";

afterEach(cleanup);

const data = {
  options: [
    { label: "Go deeper", followUp: "Tell me more" },
    { label: "Compare", action: "engines" },
    { label: "Next topic →", next: true },
  ],
};

describe("ChoicesBlock", () => {
  it("offers each option as a radio and hands the pick over", async () => {
    const choose = vi.fn(() => true);
    await renderIn("es", <ChoicesBlock data={data} choose={choose} active />);
    const group = screen.getByRole("radiogroup", { name: "¿Cómo seguimos?" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["Go deeper", "Compare", "Next topic →"]);
    expect(radios[2].className).toContain("next");
    fireEvent.click(radios[2]);
    expect(choose).toHaveBeenCalledWith({ label: "Next topic →", next: true });
    expect(radios[2].getAttribute("aria-checked")).toBe("true");
    expect((radios[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("stays unpicked when the pick is refused", async () => {
    await renderIn("en", <ChoicesBlock data={data} choose={() => false} active />);
    fireEvent.click(screen.getByRole("radio", { name: "Go deeper" }));
    expect(screen.getByRole("radio", { name: "Go deeper" }).getAttribute("aria-checked")).toBe("false");
    expect((screen.getByRole("radio", { name: "Compare" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("can't be used once the conversation moved on, and shows nothing for malformed data", async () => {
    await renderIn(
      "en",
      <>
        <ChoicesBlock data={data} choose={() => true} active={false} />
        <ChoicesBlock data={{ options: [{ nope: 1 }, "x"] }} choose={() => true} active />
        <ChoicesBlock data={null} choose={() => true} active />
      </>,
    );
    expect(screen.getAllByRole("radiogroup")).toHaveLength(1);
    expect(screen.getAllByRole("radio").every((r) => (r as HTMLButtonElement).disabled)).toBe(true);
  });
});

describe("readOptions", () => {
  it("keeps only well-formed fields", () => {
    expect(readOptions({ options: [{ label: "A", followUp: "", action: 3, next: "yes" }, { label: "B", action: "turn", next: true }] })).toEqual([
      { label: "A" },
      { label: "B", action: "turn", next: true },
    ]);
  });
});
```

Create `packages/ui/test/flow-parts.test.tsx`:
```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "@humanharness/i18n";
import type { AppState, TaskView } from "../src/client";
import { FlowSide } from "../src/FlowSide";
import { StartView } from "../src/StartView";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const L = (en: string, es = en) => ({ es, en });
function state(): AppState {
  const s = new FakeClient().state;
  s.actions = {
    manifest: { label: L("The manifest", "El manifiesto"), description: L("What a harness declares."), cost: "medium" },
    engines: { label: L("Engines", "Motores"), cost: "medium" },
    turn: { label: L("A turn", "Un turno"), cost: "medium" },
  };
  s.path = ["manifest", "engines", "turn"];
  s.references = [{ id: "source", label: L("Source", "Código"), path: "~/code/humanharness" }];
  return s;
}
const idle = (actions: TaskView["actions"] = {}): TaskView => ({ current: null, actions, notes: [] });

describe("FlowSide", () => {
  it("marks done, current and pending steps, starts a step, and shows the read-only folder", async () => {
    const onStart = vi.fn();
    await renderIn("en", <FlowSide state={state()} lang="en" tasks={idle({ manifest: "done" })} disabled={false} onStart={onStart} onOpenNote={() => {}} />);
    const steps = screen.getByRole("list", { name: "Guided path" });
    expect(within(steps).getByRole("button", { name: /Engines/ }).getAttribute("aria-current")).toBe("step");
    expect(within(steps).getByRole("button", { name: /The manifest/ }).textContent).toContain("Done");
    expect(within(steps).getByRole("button", { name: /A turn/ }).getAttribute("aria-current")).toBeNull();
    fireEvent.click(within(steps).getByRole("button", { name: /A turn/ }));
    expect(onStart).toHaveBeenCalledWith("turn");
    expect(screen.getByText("~/code/humanharness")).toBeTruthy();
    expect(screen.getByText("Read only: the AI doesn't change anything here")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "What's clear so far" })).toBeNull();
  });

  it("marks the running task's step without restarting it, and lists the notes", async () => {
    const onOpenNote = vi.fn();
    const tasks: TaskView = {
      current: { id: "t1", action: "turn", status: "waiting" },
      actions: {},
      notes: [{ slug: "manifest", title: "El manifiesto", action: "manifest", date: "", summary: ["a"], decisions: [], path: ".harness/notes/manifest.md" }],
    };
    await renderIn("es", <FlowSide state={state()} lang="es" tasks={tasks} disabled={false} onStart={() => {}} onOpenNote={onOpenNote} />);
    const turn = within(screen.getByRole("list", { name: "Recorrido" })).getByRole("button", { name: /Un turno/ });
    expect(turn.getAttribute("aria-current")).toBe("step");
    expect((turn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(screen.getByRole("list", { name: "Lo que ya quedó claro" })).getByRole("button", { name: "El manifiesto" }));
    expect(onOpenNote).toHaveBeenCalledWith("manifest");
  });
});

describe("StartView", () => {
  it("shows the topics in path order with their badges, then the rest, and starts them", async () => {
    const onStart = vi.fn();
    const s = state();
    s.actions.extra = { label: L("Extra"), description: L("Not on the path"), cost: "light" };
    await renderIn(
      "en",
      <StartView state={s} lang="en" tasks={idle({ manifest: "done", turn: "unsaved" })} notice={null} disabled={false} onStart={onStart} onAsk={() => {}} />,
    );
    const topics = within(screen.getByRole("region", { name: "Where do we start?" })).getAllByRole("button");
    expect(topics.map((b) => b.querySelector(".hh-topic-title")?.textContent)).toEqual(["The manifest", "Engines", "A turn", "Extra"]);
    expect(topics[0].textContent).toContain("Done");
    expect(topics[1].textContent).toContain("Next on the path");
    expect(topics[1].className).toContain("next");
    expect(topics[2].textContent).toContain("No summary");
    expect(topics[0].textContent).toContain("What a harness declares.");
    fireEvent.click(topics[3]);
    expect(onStart).toHaveBeenCalledWith("extra");
    expect(screen.getByText("Pick a topic, or ask a question below.")).toBeTruthy();
  });

  it("uses the harness's copy, asks its frequent questions and shows a notice", async () => {
    const onAsk = vi.fn();
    const i18n = await createI18n("en", { en: { title: "Which part?", intro: "Pick one.", faq: { own: "How do I build my own?" } } });
    render(
      <I18nextProvider i18n={i18n}>
        <StartView
          state={state()}
          lang="en"
          tasks={idle()}
          copy={{ title: "title", intro: "intro", faq: ["faq.own"] }}
          notice="You're now using Codex."
          disabled={false}
          onStart={() => {}}
          onAsk={onAsk}
        />
      </I18nextProvider>,
    );
    expect(screen.getByRole("region", { name: "Which part?" })).toBeTruthy();
    expect(screen.getByText("Pick one.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("You're now using Codex.");
    fireEvent.click(screen.getByRole("button", { name: "How do I build my own?" }));
    expect(onAsk).toHaveBeenCalledWith("How do I build my own?");
  });
});
```

Run: `corepack pnpm vitest run packages/ui/test/choices.test.tsx packages/ui/test/flow-parts.test.tsx`
Expected: FAIL (the components don't exist).

- [ ] **Step 2: ChoicesBlock**

Create `packages/ui/src/ChoicesBlock.tsx`:
```tsx
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChoiceOption } from "./client";

/** The options of a `choices` block, keeping only well-formed fields (the agent wrote them). */
export function readOptions(data: unknown): ChoiceOption[] {
  const raw = (data as { options?: unknown } | null | undefined)?.options;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((o): ChoiceOption[] => {
    if (!o || typeof o !== "object") return [];
    const x = o as Record<string, unknown>;
    if (typeof x.label !== "string" || !x.label) return [];
    return [
      {
        label: x.label,
        ...(typeof x.followUp === "string" && x.followUp ? { followUp: x.followUp } : {}),
        ...(typeof x.action === "string" && x.action ? { action: x.action } : {}),
        ...(x.next === true ? { next: true as const } : {}),
      },
    ];
  });
}

/** The core `choices` block: how to continue. A pick goes to the app, which moves the task along. */
export function ChoicesBlock({ data, choose, active }: { data: unknown; choose: (option: ChoiceOption) => boolean; active: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const [picked, setPicked] = useState<number | null>(null);
  const options = readOptions(data);
  if (options.length === 0) return null;
  return (
    <section className="hh-choices">
      <h3 id={id}>{t("choices.title")}</h3>
      <div className="hh-choice-list" role="radiogroup" aria-labelledby={id}>
        {options.map((o, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={picked === i}
            className={o.next ? "hh-choice next" : "hh-choice"}
            disabled={!active || picked !== null}
            onClick={() => {
              if (choose(o)) setPicked(i);
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: FlowSide**

Create `packages/ui/src/FlowSide.tsx`:
```tsx
import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { Language } from "@humanharness/harness-sdk";
import { CheckIcon, LockIcon, NoteIcon } from "./chrome";
import { type AppState, type TaskView, nextInPath } from "./client";

/** Flow mode's left panel: the guided path, the notes so far and the read-only reference folders. */
export function FlowSide({
  state,
  lang,
  tasks,
  disabled,
  onStart,
  onOpenNote,
}: {
  state: AppState;
  lang: Language;
  tasks: TaskView;
  disabled: boolean;
  onStart: (action: string) => void;
  onOpenNote: (slug: string) => void;
}) {
  const { t } = useTranslation();
  const pathId = useId();
  const notesId = useId();
  const path = (state.path ?? []).filter((id) => state.actions[id]);
  // The step on screen: the running task's, or (idle) the one the path suggests next.
  const current = tasks.current ? tasks.current.action : (nextInPath(path, undefined, tasks.actions) ?? undefined);
  return (
    <nav className="hh-flow-side" aria-label={t("flow.path")}>
      {path.length > 0 && (
        <section>
          <h2 id={pathId} className="hh-flow-heading">
            {t("flow.path")}
          </h2>
          <ol className="hh-steps" aria-labelledby={pathId}>
            {path.map((id, i) => {
              const here = id === current;
              const done = tasks.actions[id] === "done" && !here;
              return (
                <li key={id}>
                  <button
                    type="button"
                    aria-current={here ? "step" : undefined}
                    disabled={disabled || (here && tasks.current !== null)}
                    onClick={() => onStart(id)}
                  >
                    <span className={done ? "hh-step-mark done" : "hh-step-mark"} aria-hidden="true">
                      {done ? <CheckIcon /> : i + 1}
                    </span>
                    {state.actions[id].label[lang]}
                    {done && <span className="hh-sr-only"> {t("flow.seen")}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      )}
      {tasks.notes.length > 0 && (
        <section>
          <h2 id={notesId} className="hh-flow-heading">
            {t("flow.covered")}
          </h2>
          <ul className="hh-rows hh-note-list" aria-labelledby={notesId}>
            {tasks.notes.map((n) => (
              <li key={n.slug}>
                <button type="button" onClick={() => onOpenNote(n.slug)}>
                  <NoteIcon />
                  {n.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {(state.references ?? []).length > 0 && (
        <div className="hh-flow-refs">
          {(state.references ?? []).map((r) => (
            <p key={r.id} className="hh-flow-ref">
              <code title={r.label[lang]}>{r.path}</code>
              <span>
                <LockIcon />
                {t("flow.readOnly")}
              </span>
            </p>
          ))}
        </div>
      )}
    </nav>
  );
}
```

- [ ] **Step 4: StartView**

Create `packages/ui/src/StartView.tsx`:
```tsx
import { useTranslation } from "react-i18next";
import type { Language } from "@humanharness/harness-sdk";
import { CheckIcon } from "./chrome";
import { type AppState, type TaskView, nextInPath } from "./client";

/** The start view's copy: keys of the harness's own strings (its `locales`). */
export interface StartViewCopy {
  title?: string;
  intro?: string;
  /** Questions offered as chips: each starts a free-question task. */
  faq?: string[];
  /** One line under the composer. */
  hint?: string;
}

/** Flow mode with no task on screen: the topics (path order first) and frequent questions. */
export function StartView({
  state,
  lang,
  tasks,
  copy = {},
  notice,
  disabled,
  onStart,
  onAsk,
}: {
  state: AppState;
  lang: Language;
  tasks: TaskView;
  copy?: StartViewCopy;
  /** A notice to show first (the engine changed, the folder went back). */
  notice: string | null;
  disabled: boolean;
  onStart: (action: string) => void;
  onAsk: (question: string) => void;
}) {
  const { t } = useTranslation();
  const path = (state.path ?? []).filter((id) => state.actions[id]);
  const ids = [...path, ...Object.keys(state.actions).filter((id) => !path.includes(id))];
  const suggested = nextInPath(path, undefined, tasks.actions);
  const text = (key: string | undefined, fallback: string) => (key ? t(key, { ns: "harness" }) : fallback);
  return (
    <section className="hh-start-view" aria-labelledby="hh-start-title">
      {notice && (
        <p className="hh-start-notice" role="status">
          {notice}
        </p>
      )}
      <div className="hh-start-head">
        <h2 id="hh-start-title">{text(copy.title, t("flow.startTitle"))}</h2>
        <p>{text(copy.intro, t("flow.startIntro"))}</p>
      </div>
      <div className="hh-topics">
        {ids.map((id) => {
          const action = state.actions[id];
          const status = tasks.actions[id];
          const next = id === suggested;
          return (
            <button
              key={id}
              type="button"
              className={`hh-topic${status === "done" ? " done" : ""}${next ? " next" : ""}`}
              disabled={disabled}
              onClick={() => onStart(id)}
            >
              <span className="hh-topic-head">
                <span className="hh-topic-title">{action.label[lang]}</span>
                {status === "done" ? (
                  <span className="hh-badge ok">
                    <CheckIcon />
                    {t("flow.seen")}
                  </span>
                ) : next ? (
                  <span className="hh-badge">{t("flow.nextUp")}</span>
                ) : status ? (
                  <span className="hh-badge">{t(`flow.${status}`)}</span>
                ) : null}
              </span>
              {action.description && <span className="hh-topic-text">{action.description[lang]}</span>}
            </button>
          );
        })}
      </div>
      {copy.faq && copy.faq.length > 0 && (
        <div className="hh-faq">
          <h3 className="hh-flow-heading">{t("flow.faq")}</h3>
          <div className="hh-chips">
            {copy.faq.map((key) => {
              const question = t(key, { ns: "harness" });
              return (
                <button key={key} type="button" className="hh-chip" disabled={disabled} onClick={() => onAsk(question)}>
                  {question}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Styles**

Append to `packages/ui/src/styles.css`:
```css
/* Flow mode (spec 2026-10-12, mockups "Plan 3 · Explicador"): side panel, start view, choices. */
.hh-flow-side { width: 248px; flex: none; box-sizing: border-box; padding: 18px 14px; display: flex; flex-direction: column; gap: 18px; border-right: 1px solid var(--hh-line); overflow-y: auto; }
.hh-flow-heading { margin: 0 0 6px; padding-left: 6px; font-size: 12px; font-weight: 600; color: var(--hh-muted); }
.hh-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.hh-steps button { width: 100%; height: auto; justify-content: flex-start; gap: 9px; padding: 6px 8px; border-color: transparent; background: transparent; color: var(--hh-slate); text-align: left; }
.hh-steps button[aria-current="step"] { background: var(--hh-surface); border-color: var(--hh-line); color: var(--hh-ink); font-weight: 600; }
.hh-step-mark { width: 18px; height: 18px; flex: none; box-sizing: border-box; display: grid; place-items: center; border-radius: 50%; border: 1px solid var(--hh-line-strong); font-size: 11px; color: var(--hh-muted); }
.hh-step-mark.done { border-color: transparent; color: var(--hh-ok); }
[aria-current="step"] .hh-step-mark { border-color: transparent; background: var(--hh-ink); color: var(--hh-on-ink); }
.hh-note-list { list-style: none; margin: 0; padding: 0; }
.hh-note-list li + li { border-top: 1px solid var(--hh-line); }
.hh-note-list button { width: 100%; height: auto; justify-content: flex-start; gap: 7px; padding: 8px 10px; border: none; border-radius: 0; background: transparent; text-align: left; }
.hh-flow-refs { margin-top: auto; display: grid; gap: 8px; }
.hh-flow-ref { padding-left: 6px; display: grid; gap: 3px; font-size: 12px; color: var(--hh-muted); }
.hh-flow-ref span { display: flex; align-items: center; gap: 5px; }
.hh-start-view { display: grid; gap: 18px; padding: 14px 24px; }
.hh-start-head { display: grid; gap: 6px; }
.hh-start-head h2 { font-family: var(--hh-display); font-size: 22px; font-weight: 600; }
.hh-start-head p { color: var(--hh-slate); line-height: 1.5; }
.hh-start-notice { color: var(--hh-slate); background: var(--hh-surface); border: 1px solid var(--hh-line); border-radius: 10px; padding: 8px 12px; }
.hh-topics { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.hh-topic { height: auto; min-height: 104px; flex-direction: column; align-items: flex-start; justify-content: flex-start; gap: 6px; padding: 14px 16px; border-radius: 12px; border-color: var(--hh-line); text-align: left; }
.hh-topic.next { border: 2px solid var(--hh-ink); padding: 13px 15px; }
.hh-topic.done .hh-topic-title { color: var(--hh-slate); }
.hh-topic-head { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.hh-topic-title { font-size: 14px; font-weight: 600; }
.hh-topic-text { color: var(--hh-slate); line-height: 1.45; }
.hh-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 5px; background: var(--hh-segment); color: var(--hh-ink); font-size: 11px; font-weight: 600; white-space: nowrap; }
.hh-badge.ok { padding: 0; background: transparent; color: var(--hh-ok); }
.hh-faq { display: grid; gap: 8px; }
.hh-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.hh-chip { height: 30px; border-radius: 15px; border-color: var(--hh-line-strong); background: var(--hh-sheet); }
.hh-choices { display: grid; gap: 9px; padding: 12px 14px; border: 1px solid var(--hh-line); border-radius: 12px; background: var(--hh-sheet); }
.hh-choice-list { display: flex; flex-wrap: wrap; gap: 8px; }
.hh-choice { flex: 1 1 180px; height: auto; min-height: 36px; justify-content: flex-start; padding: 6px 10px; border-radius: 8px; text-align: left; }
.hh-choice.next, .hh-choice[aria-checked="true"] { background: var(--hh-ink); color: var(--hh-on-ink); border-color: var(--hh-ink); }
```

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/ui`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): choices block, guided path side panel and start view"
```

### Task 20: "Lo que quedó claro" panel

**Files:**
- Create: `packages/ui/src/NotesPanel.tsx`, `packages/ui/test/notes-panel.test.tsx`
- Modify: `packages/ui/src/styles.css`

- [ ] **Step 1: Failing tests**

Create `packages/ui/test/notes-panel.test.tsx`:
```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteView } from "../src/client";
import { NotesPanel } from "../src/NotesPanel";
import { renderIn } from "./render";

afterEach(cleanup);

const notes: NoteView[] = [
  { slug: "turn", title: "A turn", action: "turn", date: "2026-10-12T11:20:00.000Z", summary: ["Five pieces", "Events come back"], decisions: [], path: ".harness/notes/turn.md" },
  { slug: "q-chats", title: "Where chats live", date: "2026-10-11T10:00:00.000Z", summary: ["In .harness/chats"], decisions: [], path: ".harness/notes/q-chats.md" },
];

describe("NotesPanel", () => {
  it("opens the newest note with its points, path and actions; the others show how many points", async () => {
    const onResume = vi.fn();
    const onOpen = vi.fn(async () => true);
    await renderIn("es", <NotesPanel notes={notes} lang="es" disabled={false} onResume={onResume} onOpen={onOpen} onClose={() => {}} />);
    const panel = screen.getByRole("dialog", { name: "Lo que quedó claro" });
    expect(within(panel).getByText("Five pieces")).toBeTruthy();
    expect(within(panel).getByText(".harness/notes/turn.md")).toBeTruthy();
    expect(within(panel).getByText(/1 idea clave/)).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Retomar este tema" }));
    expect(onResume).toHaveBeenCalledWith(notes[0]);
    fireEvent.click(within(panel).getByRole("button", { name: "Abrir el archivo" }));
    expect(onOpen).toHaveBeenCalledWith(".harness/notes/turn.md");
    expect(within(panel).getByText("La próxima pregunta arranca desde tus resúmenes, sin volver a leer el código.")).toBeTruthy();
    expect(panel.textContent).not.toMatch(/token/i);
  });

  it("opens another note, says when a file can't be opened, and closes with Escape", async () => {
    const onClose = vi.fn();
    await renderIn("en", <NotesPanel notes={notes} expanded="q-chats" lang="en" disabled={false} onResume={() => {}} onOpen={async () => false} onClose={onClose} />);
    const panel = screen.getByRole("dialog", { name: "What's clear so far" });
    expect(within(panel).getByText("In .harness/chats")).toBeTruthy();
    expect(within(panel).queryByText("Five pieces")).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: /A turn/ }));
    expect(within(panel).getByText("Five pieces")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Open the file" }));
    expect((await within(panel).findByRole("alert")).textContent).toBe("I couldn't open that file.");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("says there are no notes yet, and can't resume while a turn runs", async () => {
    await renderIn("en", <NotesPanel notes={[]} lang="en" disabled onResume={() => {}} onOpen={async () => true} onClose={() => {}} />);
    expect(screen.getByText("No summaries yet. Each topic you close leaves one here.")).toBeTruthy();
    cleanup();
    await renderIn("en", <NotesPanel notes={notes} lang="en" disabled onResume={() => {}} onOpen={async () => true} onClose={() => {}} />);
    expect((screen.getByRole("button", { name: "Pick this topic up again" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
```

Run: `corepack pnpm vitest run packages/ui/test/notes-panel.test.tsx`
Expected: FAIL (the component doesn't exist).

- [ ] **Step 2: Implement**

Create `packages/ui/src/NotesPanel.tsx`:
```tsx
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Language } from "@humanharness/harness-sdk";
import type { NoteView } from "./client";

/** "Lo que quedó claro": the notes of `.harness/notes/`, one opened at a time. */
export function NotesPanel({
  notes,
  expanded,
  lang,
  disabled,
  onResume,
  onOpen,
  onClose,
}: {
  notes: NoteView[];
  /** The note to open first; default the newest. */
  expanded?: string;
  lang: Language;
  /** A turn runs: a topic can't be picked up now. */
  disabled: boolean;
  onResume: (note: NoteView) => void;
  onOpen: (path: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(expanded ?? notes[0]?.slug);
  const [failed, setFailed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(lang, { dateStyle: "short", timeStyle: "short" });
  };
  const openFile = (path: string) => {
    setFailed(false);
    onOpen(path).then(
      (ok) => setFailed(!ok),
      () => setFailed(true),
    );
  };

  return (
    <aside className="hh-notes" role="dialog" aria-modal="true" aria-labelledby="hh-notes-title">
      <header>
        <h2 id="hh-notes-title">{t("notes.title")}</h2>
        <button ref={closeRef} type="button" onClick={onClose}>
          {t("notes.close")}
        </button>
      </header>
      {failed && (
        <p role="alert" className="hh-warn">
          {t("notes.openFailed")}
        </p>
      )}
      {notes.length === 0 ? (
        <p className="hh-caption">{t("notes.empty")}</p>
      ) : (
        <ul className="hh-rows hh-note-cards">
          {notes.map((n) =>
            n.slug === open ? (
              <li key={n.slug} className="hh-note open">
                <div className="hh-note-head">
                  <strong>{n.title}</strong>
                  <time className="hh-caption">{when(n.date)}</time>
                </div>
                <ul>
                  {n.summary.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
                <code className="hh-caption">{n.path}</code>
                <div className="hh-note-actions">
                  <button type="button" disabled={disabled} onClick={() => onResume(n)}>
                    {t("notes.resume")}
                  </button>
                  <button type="button" onClick={() => openFile(n.path)}>
                    {t("notes.open")}
                  </button>
                </div>
              </li>
            ) : (
              <li key={n.slug} className="hh-note">
                <button type="button" className="hh-note-toggle" aria-expanded={false} onClick={() => setOpen(n.slug)}>
                  <span className="hh-note-head">
                    <strong>{n.title}</strong>
                    <time className="hh-caption">{when(n.date)}</time>
                  </span>
                  <span className="hh-caption">
                    {t("notes.keyPoints", { count: n.summary.length })} · <code>{n.path}</code>
                  </span>
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      <p className="hh-notes-savings">{t("notes.savings")}</p>
      <p className="hh-caption">{t("notes.footer")}</p>
    </aside>
  );
}
```

Append to `packages/ui/src/styles.css`:
```css
.hh-notes { position: fixed; inset: 52px 0 0 auto; width: min(420px, 100%); box-sizing: border-box; padding: 16px 18px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; background: var(--hh-sheet); border-left: 1px solid var(--hh-line-strong); box-shadow: -18px 0 50px rgba(25, 30, 36, 0.16); }
.hh-notes header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.hh-notes h2 { font-size: 15px; font-weight: 600; }
.hh-note-cards { list-style: none; margin: 0; padding: 0; }
.hh-note { display: grid; gap: 6px; padding: 11px 14px; border-top: 1px solid var(--hh-line); }
.hh-note:first-child { border-top: none; }
.hh-note.open { background: var(--hh-paper); }
.hh-note ul { margin: 0; padding-left: 18px; display: grid; gap: 3px; color: var(--hh-slate); line-height: 1.45; }
.hh-note-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.hh-note-toggle { width: 100%; height: auto; flex-direction: column; align-items: stretch; gap: 4px; padding: 0; border: none; background: transparent; text-align: left; }
.hh-note-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.hh-notes-savings { padding: 10px 12px; border: 1px solid var(--hh-line); border-radius: 10px; background: var(--hh-surface); color: var(--hh-ok); line-height: 1.45; }
```

- [ ] **Step 3: Run the tests**

Run: `corepack pnpm vitest run packages/ui`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): notes panel with resume and open"
```

### Task 21: Work screen in flow mode

`ChatView` gains flow mode (any harness with actions): the left `FlowSide`, the `StartView` while no task is on screen, only the current task's entries, the `choices` block wired to `client.choose`, the closing indicator, the notes panel, and the composer inside the main column. Blocks get `choose`, `open` and `active`. A harness without actions keeps the plain chat, so the existing `HarnessApp` tests keep passing.

**Files:**
- Modify: `packages/ui/src/Message.tsx`, `packages/ui/src/ChatView.tsx`, `packages/ui/src/HarnessApp.tsx`, `packages/ui/src/index.ts`, `packages/ui/src/styles.css`
- Create: `packages/ui/test/flow.test.tsx`

- [ ] **Step 1: Failing tests**

Create `packages/ui/test/flow.test.tsx`:
```tsx
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type BlockProps, type HarnessAppProps, HarnessApp } from "../src";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const L = (en: string) => ({ es: en, en });
const TITLE = "What do you want to understand?";
const locales = { en: { title: TITLE, faq: { own: "How do I build my own harness?" }, hint: "Answers can be wrong." } };

function flowClient() {
  const client = new FakeClient(ready);
  client.state.actions = {
    manifest: { label: L("The manifest"), description: L("What a harness declares."), cost: "medium" },
    engines: { label: L("Engines"), cost: "medium" },
    turn: { label: L("A turn"), cost: "medium" },
  };
  client.state.path = ["manifest", "engines", "turn"];
  client.state.references = [{ id: "source", label: L("Source"), path: "~/code/humanharness" }];
  return client;
}

async function startWork(client: FakeClient, props: Partial<HarnessAppProps> = {}) {
  render(<HarnessApp client={client} locales={locales} startView={{ title: "title", faq: ["faq.own"], hint: "hint" }} {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Start Demo" }));
}
/** The start view, once the conversation has loaded (its topics are enabled). */
async function startRegion() {
  const region = await screen.findByRole("region", { name: TITLE });
  await waitFor(() => expect(within(region).getAllByRole("button").every((b) => !(b as HTMLButtonElement).disabled)).toBe(true));
  return region;
}
const answer = (client: FakeClient, text: string, blocks: { name: string; data: unknown }[] = []) =>
  act(() => {
    client.emit({ type: "text", delta: text });
    for (const b of blocks) client.emit({ type: "block", ...b });
    client.emit({ type: "done", ok: true });
  });
const tasks = (client: FakeClient, view: Partial<FakeClient["tasks"]>) => act(() => client.emitTasks({ ...client.tasks, ...view }));
const choices = (...options: object[]) => ({ name: "choices", data: { options } });

describe("flow mode", () => {
  it("opens on the start view: topics, the read-only folder, questions and the composer hint", async () => {
    const client = flowClient();
    client.tasks = { current: null, actions: { manifest: "done" }, notes: [] };
    await startWork(client);
    const start = await startRegion();
    expect(within(start).getByRole("button", { name: /The manifest/ }).textContent).toContain("Done");
    expect(within(start).getByRole("button", { name: /Engines/ }).textContent).toContain("Next on the path");
    expect(within(screen.getByRole("list", { name: "Guided path" })).getByRole("button", { name: /Engines/ }).getAttribute("aria-current")).toBe("step");
    expect(screen.getByText("~/code/humanharness")).toBeTruthy();
    expect(screen.getByText("Answers can be wrong.")).toBeTruthy();
    expect(screen.getByPlaceholderText("Or ask something…")).toBeTruthy();
  });

  it("starts a topic: sends its label with the action and shows only that task", async () => {
    const client = flowClient();
    client.chat = [{ id: "old", role: "user", text: "an older topic", blocks: [], activities: [], at: "t", task: "t0" }];
    await startWork(client);
    fireEvent.click(within(await startRegion()).getByRole("button", { name: /Engines/ }));
    await waitFor(() => expect(client.sent).toEqual(["Engines"]));
    expect(client.sentOptions).toEqual([{ action: "engines" }]);
    expect(screen.queryByRole("region", { name: TITLE })).toBeNull();
    expect(screen.queryByText("an older topic")).toBeNull();
    answer(client, "Engines are detected on every start.");
    expect(screen.getByText("Engines are detected on every start.")).toBeTruthy();
  });

  it("picks options: a follow-up stays on the task, next starts the next topic", async () => {
    const client = flowClient();
    await startWork(client);
    fireEvent.click(within(await startRegion()).getByRole("button", { name: /The manifest/ }));
    answer(client, "It declares everything.", [choices({ label: "Go deeper", followUp: "Tell me more" }, { label: "Next topic →", next: true })]);
    tasks(client, { current: { id: "t1", action: "manifest", status: "waiting" } });
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "How do we continue?" })).getByRole("radio", { name: "Go deeper" }));
    await waitFor(() => expect(client.chosen).toEqual([{ label: "Go deeper", followUp: "Tell me more" }]));
    expect(screen.getByText("Go deeper", { selector: ".hh-message.user p" })).toBeTruthy();
    answer(client, "More detail.", [choices({ label: "Next topic →", next: true })]);
    const groups = screen.getAllByRole("radiogroup");
    expect((within(groups[0]).getAllByRole("radio")[0] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(groups.at(-1)!).getByRole("radio", { name: "Next topic →" }));
    await waitFor(() => expect(client.chosen).toHaveLength(2));
    expect(screen.queryByText("It declares everything.")).toBeNull();
    expect(screen.getByText("Engines", { selector: ".hh-message.user p" })).toBeTruthy();
  });

  it("closes the last topic without starting another, then goes back to the topics", async () => {
    const client = flowClient();
    client.state.path = ["manifest"];
    await startWork(client);
    fireEvent.click(within(await startRegion()).getByRole("button", { name: /The manifest/ }));
    answer(client, "It declares everything.", [choices({ label: "Done →", next: true })]);
    tasks(client, { current: { id: "t1", action: "manifest", status: "waiting" } });
    fireEvent.click(screen.getByRole("radio", { name: "Done →" }));
    await waitFor(() => expect(client.chosen).toEqual([{ label: "Done →", next: true }]));
    expect(screen.queryAllByText("Done →", { selector: ".hh-message.user p" })).toHaveLength(0);
    tasks(client, { current: { id: "t1", action: "manifest", status: "closing" } });
    expect(screen.getByText("Saving what's clear…")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Ask about this topic…"), { target: { value: "too soon" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(client.sent).toEqual(["The manifest"]);
    tasks(client, { current: null, actions: { manifest: "done" } });
    fireEvent.click(screen.getByRole("button", { name: "See the topics" }));
    expect(within(await startRegion()).getByRole("button", { name: /The manifest/ }).textContent).toContain("Done");
  });

  it("lists notes in the side panel and opens them: resume and open the file", async () => {
    const client = flowClient();
    client.tasks = {
      current: null,
      actions: { manifest: "done" },
      notes: [
        { slug: "manifest", title: "The manifest", action: "manifest", date: "2026-10-12T11:20:00.000Z", summary: ["It declares everything", "It is validated"], decisions: [], path: ".harness/notes/manifest.md" },
        { slug: "q-chats", title: "Where chats live", date: "2026-10-11T10:00:00.000Z", summary: ["In .harness/chats"], decisions: [], path: ".harness/notes/q-chats.md" },
      ],
    };
    await startWork(client);
    await startRegion();
    fireEvent.click(within(screen.getByRole("list", { name: "What's clear so far" })).getByRole("button", { name: "Where chats live" }));
    const panel = screen.getByRole("dialog", { name: "What's clear so far" });
    expect(within(panel).getByText("In .harness/chats")).toBeTruthy();
    expect(within(panel).getByText(/2 key points/)).toBeTruthy();
    client.openResult = false;
    fireEvent.click(within(panel).getByRole("button", { name: "Open the file" }));
    await waitFor(() => expect(client.opened).toEqual([".harness/notes/q-chats.md"]));
    await within(panel).findByRole("alert");
    fireEvent.click(within(panel).getByRole("button", { name: "Pick this topic up again" }));
    await waitFor(() => expect(client.sent).toEqual(['Let\'s pick up "Where chats live" again.']));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks a free question from the start view and follows up while the task waits", async () => {
    const client = flowClient();
    await startWork(client);
    fireEvent.click(within(await startRegion()).getByRole("button", { name: "How do I build my own harness?" }));
    await waitFor(() => expect(client.sent).toEqual(["How do I build my own harness?"]));
    expect(client.sentOptions).toEqual([{}]);
    answer(client, "Copy the demo.");
    tasks(client, { current: { id: "t1", status: "waiting" } });
    fireEvent.change(screen.getByPlaceholderText("Ask about this topic…"), { target: { value: "And the locales?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(client.sent).toHaveLength(2));
    expect(screen.getByText("Copy the demo.")).toBeTruthy();
  });

  it("gives harness blocks a way to open files", async () => {
    const client = flowClient();
    const Files = ({ data, open }: BlockProps) => <button onClick={() => void open(data.path)}>open it</button>;
    await startWork(client, { blocks: { files: Files } });
    fireEvent.click(within(await startRegion()).getByRole("button", { name: /A turn/ }));
    answer(client, "Here.", [{ name: "files", data: { path: "packages/ui/src/ChatView.tsx" } }]);
    fireEvent.click(screen.getByRole("button", { name: "open it" }));
    await waitFor(() => expect(client.opened).toEqual(["packages/ui/src/ChatView.tsx"]));
  });

  it("comes back to a task that is still open", async () => {
    const client = flowClient();
    client.chat = [
      { id: "1", role: "user", text: "Engines", blocks: [], activities: [], at: "t", task: "t1", action: "engines" },
      { id: "2", role: "assistant", text: "Engines are detected.", blocks: [], activities: [], at: "t", task: "t1" },
    ];
    client.tasks = { current: { id: "t1", action: "engines", status: "waiting" }, actions: {}, notes: [] };
    await startWork(client);
    await screen.findByText("Engines are detected.");
    expect(screen.queryByRole("region", { name: TITLE })).toBeNull();
  });
});
```

Run: `corepack pnpm vitest run packages/ui/test/flow.test.tsx`
Expected: FAIL (`startView` isn't a prop; no flow mode).

- [ ] **Step 2: Blocks get the task actions**

Replace `packages/ui/src/Message.tsx` with:
```tsx
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { ActivityList } from "./ActivityList";
import type { ChatEntry, ChoiceOption, SendOptions } from "./client";

export interface BlockProps {
  data: any;
  /** Sends a message as the user (e.g. the chosen option); `options.action` starts a harness action. */
  respond: (text: string, options?: SendOptions) => boolean;
  /** Picks an option of a `choices` block: the app follows up, starts another topic or moves along the path. */
  choose: (option: ChoiceOption) => boolean;
  /** Opens a file inside the reference folders or the user's folder in its default app; false when it can't. */
  open: (path: string) => Promise<boolean>;
  /** The block belongs to the latest answer and nothing is running: its buttons may act. */
  active: boolean;
}

/** What a block component can do besides showing its data. */
export type BlockActions = Omit<BlockProps, "data">;

export function Blocks({
  blocks,
  components,
  actions,
}: {
  blocks: ChatEntry["blocks"];
  components: Record<string, ComponentType<BlockProps>>;
  actions: BlockActions;
}) {
  return (
    <>
      {blocks.map((b, i) => {
        const Component = components[b.name];
        return Component ? (
          <div key={i} className="hh-block">
            <Component data={b.data} {...actions} />
          </div>
        ) : null;
      })}
    </>
  );
}

export function Message({
  entry,
  components,
  actions,
}: {
  entry: Pick<ChatEntry, "role" | "text" | "blocks" | "activities">;
  components: Record<string, ComponentType<BlockProps>>;
  actions: BlockActions;
}) {
  const { t } = useTranslation();
  if (entry.role === "assistant" && !entry.text && entry.blocks.length === 0 && entry.activities.length === 0) return null;
  return (
    <article className={`hh-message ${entry.role}`}>
      {entry.role === "user" && <span className="hh-who">{t("chat.you")}</span>}
      {entry.role === "assistant" && <ActivityList items={entry.activities.map((a) => ({ ...a, done: true }))} />}
      {entry.text && entry.text.split("\n\n").map((p, i) => <p key={i}>{p}</p>)}
      <Blocks blocks={entry.blocks} components={components} actions={actions} />
    </article>
  );
}
```

- [ ] **Step 3: ChatView**

Replace `packages/ui/src/ChatView.tsx` with:
```tsx
import { type ComponentType, type FormEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityList } from "./ActivityList";
import { ChoicesBlock } from "./ChoicesBlock";
import { GearIcon, TopBar } from "./chrome";
import { type AppState, type ChoiceOption, type EngineProblem, type HarnessClient, type NoteView, type SendOptions, type TaskView, nextInPath } from "./client";
import { ErrorCard, isFixable, problemError } from "./ErrorCard";
import { FlowSide } from "./FlowSide";
import { uiLanguage } from "./FolderStep";
import { HistoryPanel } from "./HistoryPanel";
import { type BlockActions, type BlockProps, Blocks, Message } from "./Message";
import { NotesPanel } from "./NotesPanel";
import { type StartViewCopy, StartView } from "./StartView";
import { initialChat, reduceChat } from "./state";
import { UsageMeter } from "./UsageMeter";
import { type Preflight, lastTurnTokens, percent, preflight } from "./usage";

/** How close to the bottom (px) the user must be for new content to keep the chat pinned. */
const STICK_THRESHOLD = 80;
const NO_TASKS: TaskView = { current: null, actions: {}, notes: [] };

export type SendFn = (text: string, options?: SendOptions) => boolean;

/** A heavy action waiting for the user's go-ahead: a message to send, or a picked option. */
type Pending = { action: string; check: Preflight } & (
  | { kind: "send"; text: string; options: SendOptions }
  | { kind: "choose"; option: ChoiceOption }
);

export function ChatView({
  client,
  state,
  components,
  stateBlocks,
  renderSide,
  startView,
  engineProblem,
  onHome,
  onSettings,
  onFixEngine,
  onTurnOk,
}: {
  client: HarnessClient;
  state: AppState;
  components: Record<string, ComponentType<BlockProps>>;
  stateBlocks: string[];
  renderSide?: (blockState: Record<string, unknown>, send: SendFn) => ReactNode;
  /** Flow mode's start view (keys of the harness's strings). */
  startView?: StartViewCopy;
  /** What the background check found wrong with the engine, if anything. */
  engineProblem?: EngineProblem | null;
  onHome?: () => void;
  onSettings?: () => void;
  onFixEngine?: () => void;
  /** A turn has just ended without an error (the engine works: its background check can be redone). */
  onTurnOk?: () => void;
}) {
  const { t, i18n } = useTranslation();
  // save_note never shows: a note reaches the side panel as a file, through the tasks.
  const [chat, dispatch] = useReducer(reduceChat, undefined, () => initialChat([], [...stateBlocks, "save_note"]));
  const [draft, setDraft] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [notesPanel, setNotesPanel] = useState<{ expanded?: string } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [estimates, setEstimates] = useState<Record<string, number>>({});
  /** The saved conversation couldn't be read. */
  const [loadFailed, setLoadFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [tasks, setTasks] = useState<TaskView>(NO_TASKS);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  /** Flow mode: where the task on screen starts in the conversation; null shows the start view. */
  const [since, setSince] = useState<number | null>(null);
  /** A notice for the start view (the engine changed, the folder went back). */
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  /** `since` was set (by the user or from the open task): loading must not move it. */
  const placed = useRef(false);
  const preflightRef = useRef<HTMLDivElement>(null);
  const notNowRef = useRef<HTMLButtonElement>(null);
  /** What had focus when the pre-flight question opened (the action's button): it gets focus back on "Not now". */
  const preflightOpener = useRef<HTMLElement | null>(null);
  const chatRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  // Set synchronously on send so two quick clicks can't both pass before the live turn renders.
  const busy = useRef(false);
  const wasLive = useRef(false);
  const lang = uiLanguage(state, i18n.language);
  const engineOption = state.engines.find((e) => e.id === state.config.engineId);
  const engine = engineOption?.name ?? state.config.engineId ?? "";
  /** Any harness with actions runs as tasks: topics, a guided path, one task on screen at a time. */
  const flow = Object.keys(state.actions).length > 0;
  const path = state.path ?? [];
  const closing = tasks.current?.status === "closing";
  const all = useMemo(() => ({ ...components, choices: ChoicesBlock as ComponentType<BlockProps> }), [components]);
  const labelOf = (id: string) => state.actions[id]?.label[lang] ?? id;

  useEffect(() => {
    client.loadChat().then(
      ({ entries, switchedFrom }) => {
        dispatch({ type: "loaded", entries });
        setLoaded(true);
        if (switchedFrom) {
          const text = t("chat.switched", { engine });
          dispatch({ type: "notice", text, at: new Date().toISOString() });
          setNotice(text);
        }
      },
      () => {
        setLoadFailed(true);
        setLoaded(true);
      },
    );
    client.getUsage().then(
      (u) => {
        setEstimates(u.estimates);
        if (u.limits) dispatch({ type: "limits", status: "allowed", windows: u.limits });
      },
      () => {},
    );
    client.getTasks().then(
      (v) => {
        setTasks(v);
        setTasksLoaded(true);
      },
      () => setTasksLoaded(true),
    );
    const offTasks = client.onTasks(setTasks);
    const offEvents = client.onEvent((e) => dispatch(e));
    return () => {
      offTasks();
      offEvents();
    };
  }, [client]);

  // Flow mode, once the conversation and the tasks are known: a task still open shows its own entries.
  useEffect(() => {
    if (!flow || placed.current || !loaded || !tasksLoaded) return;
    placed.current = true;
    const id = tasks.current?.id;
    if (!id) return;
    const first = chat.entries.findIndex((e) => e.task === id);
    setSince(first >= 0 ? first : chat.entries.length);
  }, [flow, loaded, tasksLoaded, tasks, chat.entries]);

  useEffect(() => {
    if (!chat.live) busy.current = false;
  }, [chat.live]);

  // The pre-flight question gets focus on its safe answer ("Not now") and comes into view.
  const asking = pending !== null;
  useEffect(() => {
    if (!asking) return;
    preflightRef.current?.scrollIntoView?.({ block: "nearest" });
    notNowRef.current?.focus();
  }, [asking]);

  useLayoutEffect(() => {
    const el = chatRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.entries, chat.live]);

  useEffect(() => {
    if (chat.live && !wasLive.current) setAnnouncement(t("chat.working"));
    if (!chat.live && wasLive.current) {
      setAnnouncement(chat.entries.findLast((e) => e.role === "assistant")?.text ?? "");
      inputRef.current?.focus();
      client.getUsage().then((u) => setEstimates(u.estimates), () => {});
      if (!chat.entries.at(-1)?.error) onTurnOk?.();
    }
    wasLive.current = Boolean(chat.live);
  }, [chat.live, chat.entries, t, client, onTurnOk]);

  /** A turn runs, is about to, or the task is saving its note. */
  const blocked = (): boolean => Boolean(chat.live) || busy.current || closing;
  /** A new task goes on screen: its entries start after everything there now. */
  const showNewTask = () => {
    placed.current = true;
    setSince(chat.entries.length);
    setNotice(null);
  };
  const failTurn = (err: unknown) =>
    dispatch({ type: "done", ok: false, error: { code: "agent-crashed", detail: err instanceof Error ? err.message : String(err) } });
  const openPreflight = (p: Pending) => {
    preflightOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPending(p);
  };

  /** True when the message was sent, or is waiting for the user to confirm a heavy action. */
  const send = (text: string, options: SendOptions = {}, confirmed = false): boolean => {
    const message = text.trim();
    if (!message || blocked() || (pending && !confirmed)) return false;
    if (!confirmed && options.action) {
      const check = preflight(state.actions[options.action]?.cost, chat.limits, estimates[options.action]);
      if (check) {
        openPreflight({ kind: "send", action: options.action, check, text: message, options });
        return true;
      }
    }
    busy.current = true;
    stick.current = true;
    if (flow && (options.action || !tasks.current)) showNewTask();
    dispatch({ type: "user", text: message, at: new Date().toISOString(), ...(options.action ? { action: options.action } : {}) });
    client.send(message, options).catch(failTurn);
    inputRef.current?.focus();
    return true;
  };

  /** A pick in a `choices` block: a follow-up stays on screen; another topic replaces it; the end of the path just closes. */
  const choose = (option: ChoiceOption, confirmed = false): boolean => {
    if (blocked() || (pending && !confirmed)) return false;
    const action = option.action && state.actions[option.action] ? option.action : undefined;
    const moves = Boolean(option.next || action);
    const target = option.next ? nextInPath(path, tasks.current?.action, tasks.actions) : (action ?? null);
    if (!confirmed && target) {
      const check = preflight(state.actions[target]?.cost, chat.limits, estimates[target]);
      if (check) {
        openPreflight({ kind: "choose", action: target, check, option });
        return true;
      }
    }
    stick.current = true;
    const at = new Date().toISOString();
    if (!moves) {
      busy.current = true;
      dispatch({ type: "user", text: option.label, at });
    } else if (target) {
      busy.current = true;
      showNewTask();
      dispatch({ type: "user", text: labelOf(target), at, action: target });
    }
    client.choose(option).catch((err: unknown) => {
      if (!moves || target) failTurn(err);
    });
    return true;
  };

  const startTopic = (id: string) => void send(labelOf(id), { action: id });
  const resume = (note: NoteView) => {
    setNotesPanel(null);
    if (note.action && state.actions[note.action]) startTopic(note.action);
    else send(t("notes.resumeQuestion", { title: note.title }));
  };
  const openFile = (file: string) => client.openPath(file).catch(() => false);
  /** "Not now" (or Escape): nothing is sent, and focus goes back to whatever asked. */
  const closePreflight = () => {
    setPending(null);
    const opener = preflightOpener.current;
    preflightOpener.current = null;
    if (opener?.isConnected) opener.focus();
    else inputRef.current?.focus();
  };
  /** What harness UI gets: it can't skip the pre-flight check. */
  const sendFromHarness: SendFn = (text, options) => send(text, options);
  const lastAssistant = chat.entries.findLast((e) => e.role === "assistant");
  const blockActions = (active: boolean): BlockActions => ({ respond: sendFromHarness, choose: (o) => choose(o), open: openFile, active });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (send(draft)) setDraft("");
  };
  const onScroll = () => {
    const el = chatRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD;
  };
  const last = chat.entries.at(-1);
  const lastUser = chat.entries.findLast((e) => e.role === "user");
  const backgroundError = engineProblem ? problemError(engineProblem) : null;
  const shown = !flow ? chat.entries : since === null ? [] : chat.entries.slice(since);
  const showStart = flow && since === null && !chat.live;
  const placeholder = !flow ? t("chat.placeholder") : tasks.current ? t("flow.placeholderTask") : t("flow.placeholderStart");

  let preflightText = "";
  if (pending) {
    const label = labelOf(pending.action);
    const left = percent(pending.check.left);
    preflightText =
      pending.check.estimate !== null
        ? t("preflight.estimate", { action: label, estimate: Math.max(1, percent(pending.check.estimate)), left })
        : t("preflight.hint", { action: label, left });
  }

  return (
    <div className="hh-app">
      <TopBar title={state.harness.name[lang]}>
        <UsageMeter engine={engineOption} limits={chat.limits} lastTokens={lastTurnTokens(chat.entries)} />
        {onHome && <button onClick={onHome}>{t("chat.home")}</button>}
        <button onClick={() => setShowHistory(true)}>{t("history.title")}</button>
        {onSettings && (
          <button className="hh-icon-button" aria-label={t("home.settings")} onClick={onSettings}>
            <GearIcon />
          </button>
        )}
      </TopBar>
      <div className="hh-body">
        {flow && (
          <FlowSide
            state={state}
            lang={lang}
            tasks={tasks}
            disabled={blocked() || !loaded}
            onStart={startTopic}
            onOpenNote={(slug) => setNotesPanel({ expanded: slug })}
          />
        )}
        <main className="hh-main">
          <section className="hh-chat" ref={chatRef} onScroll={onScroll}>
            {loadFailed && (
              <p className="hh-error" role="alert">
                {t("chat.loadError")}
              </p>
            )}
            {/* The last turn's card already offers the fix for this same problem: one fix button is enough. */}
            {backgroundError && !(isFixable(last?.error) && last?.error?.code === backgroundError.code) && (
              <ErrorCard error={backgroundError} engine={engine} onFix={onFixEngine} />
            )}
            {showStart && (
              <StartView
                state={state}
                lang={lang}
                tasks={tasks}
                copy={startView}
                notice={notice}
                disabled={blocked() || !loaded}
                onStart={startTopic}
                onAsk={(q) => void send(q)}
              />
            )}
            {flow && since !== null && !tasks.current && !chat.live && (
              <button type="button" className="hh-back-topics" onClick={() => setSince(null)}>
                {t("flow.backToTopics")}
              </button>
            )}
            {shown.map((entry) => (
              <div key={entry.id}>
                <Message entry={entry} components={all} actions={blockActions(entry === lastAssistant && !chat.live && !closing)} />
                {entry.error && entry === last && (
                  <ErrorCard
                    error={entry.error}
                    engine={engine}
                    limits={chat.limits}
                    onFix={onFixEngine}
                    onRetry={lastUser ? () => send(lastUser.text, lastUser.action ? { action: lastUser.action } : {}) : undefined}
                  />
                )}
              </div>
            ))}
            {chat.live && (
              <article className="hh-message assistant live">
                <ActivityList items={chat.live.activities} />
                {chat.live.text ? chat.live.text.split("\n\n").map((p, i) => <p key={i}>{p}</p>) : <p className="hh-working">{t("chat.working")}</p>}
                <Blocks blocks={chat.live.blocks} components={all} actions={blockActions(false)} />
              </article>
            )}
            {closing && !chat.live && (
              <p className="hh-working" role="status">
                {t("flow.closing")}
              </p>
            )}
            {pending && (
              <div
                ref={preflightRef}
                className="hh-confirm"
                role="alertdialog"
                aria-labelledby="hh-preflight-title"
                aria-describedby="hh-preflight-text"
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
                  e.preventDefault();
                  closePreflight();
                }}
              >
                <p id="hh-preflight-title">
                  <strong className="hh-warn">{t("preflight.title")}</strong>
                </p>
                <p id="hh-preflight-text">{preflightText}</p>
                <button
                  className="hh-primary"
                  onClick={() => {
                    const p = pending;
                    setPending(null);
                    if (p.kind === "send") send(p.text, p.options, true);
                    else choose(p.option, true);
                  }}
                >
                  {t("preflight.continue")}
                </button>
                <button ref={notNowRef} onClick={closePreflight}>
                  {t("preflight.notNow")}
                </button>
              </div>
            )}
          </section>
          <form className="hh-composer" onSubmit={onSubmit}>
            <textarea
              ref={inputRef}
              aria-label={placeholder}
              placeholder={placeholder}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey) return;
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                e.preventDefault();
                if (send(draft)) setDraft("");
              }}
            />
            {chat.live ? (
              <button type="button" onClick={() => void client.cancel()}>
                {t("chat.stop")}
              </button>
            ) : (
              <button type="submit">{t("chat.send")}</button>
            )}
          </form>
          {startView?.hint && <p className="hh-composer-hint">{t(startView.hint, { ns: "harness" })}</p>}
        </main>
        {renderSide && <aside className="hh-side">{renderSide(chat.blockState, sendFromHarness)}</aside>}
      </div>
      <div className="hh-sr-only" aria-live="polite">
        {announcement}
      </div>
      {showHistory && (
        <HistoryPanel
          client={client}
          disabled={Boolean(chat.live)}
          onClose={() => setShowHistory(false)}
          onRestored={() => {
            const text = t("history.restored");
            dispatch({ type: "notice", text, at: new Date().toISOString() });
            setNotice(text);
          }}
        />
      )}
      {notesPanel && (
        <NotesPanel
          notes={tasks.notes}
          expanded={notesPanel.expanded}
          lang={lang}
          disabled={blocked()}
          onResume={resume}
          onOpen={openFile}
          onClose={() => setNotesPanel(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: HarnessApp and exports**

In `packages/ui/src/HarnessApp.tsx`, add the import:
```tsx
import type { StartViewCopy } from "./StartView";
```
add to `HarnessAppProps` after `locales?: Locales;`:
```tsx
  /** Flow mode's start view: keys of `locales` for its title, intro, frequent questions and composer hint. */
  startView?: StartViewCopy;
```
replace the component's signature line with:
```tsx
export function HarnessApp({ client, blocks = {}, stateBlocks = [], renderSide, locales, startView }: HarnessAppProps) {
```
and add `startView={startView}` to the `<ChatView … />` props (after `renderSide={renderSide}`).

In `packages/ui/src/index.ts`, replace `export type { BlockProps } from "./Message";` with:
```ts
export type { BlockActions, BlockProps } from "./Message";
export type { StartViewCopy } from "./StartView";
```

- [ ] **Step 5: Layout**

In `packages/ui/src/styles.css`, replace the `.hh-app`, `.hh-body`, `.hh-chat` and `.hh-side` rules with:
```css
.hh-app { display: grid; grid-template-rows: 52px 1fr; height: 100vh; }
.hh-body { display: flex; min-height: 0; overflow: hidden; }
.hh-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.hh-chat { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; display: grid; gap: 12px; align-content: start; }
.hh-side { width: 240px; flex: none; padding: 16px; border-left: 1px solid var(--hh-line); }
.hh-composer-hint { margin: -4px 16px 12px; text-align: center; color: var(--hh-muted); font-size: 11px; }
.hh-back-topics { justify-self: start; }
```
and replace the last line (the `@media (max-width: 640px)` rule) with:
```css
@media (max-width: 640px) { .hh-flow-side, .hh-side { display: none; } }
```

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/ui`
Expected: PASS (the new flow tests, and every existing `HarnessApp` test: harnesses without actions keep the plain chat, and the heavy-action tests, which declare an action, still get the pre-flight question).

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): work screen in flow mode — start view, guided path, choices, notes"
```

---

## Phase 6 — Demo

### Task 22: Curated architecture docs

One short doc per demo topic, written from the code as it stands after Tasks 1–21. They anchor the explainer's answers and bound its reading. Before committing, check every path and name in them against the repository (`git ls-files`, and a search for each function named).

**Files:**
- Create: `docs/architecture/manifest.md`, `docs/architecture/engines.md`, `docs/architecture/turn.md`, `docs/architecture/blocks.md`, `docs/architecture/context.md`, `docs/architecture/history.md`

- [ ] **Step 1: Write the docs**

`docs/architecture/manifest.md`:
```md
# The manifest

A harness is a folder whose `harness.config.ts` default-exports `defineHarness({...})` from `@humanharness/harness-sdk`. `defineHarness` validates the object with zod and fills the defaults; `loadHarness` imports it from plain Node (so the manifest holds no React) and records the harness folder as `root`.

## What each field does

| Field | What the core does with it |
|---|---|
| `id`, `name`, `tagline`, `logo`, `author`, `donate` | Window title, Home screen, Settings → About |
| `languages` | Languages the interface and the agent may use (`es`, `en`) |
| `engines` | Engines the harness was tested with; `availableEngines` in `packages/engines` keeps the ones whose terms allow it |
| `folder.suggested`, `folder.seed` | Where the person's work lives; the seed is copied there the first time (`prepareFolder`) |
| `folder.references` | Folders the agent may read but never change; `"app-source"` is the repository the app runs from, in development |
| `instructions` | The base `AGENTS.md`; the core appends a managed section (`writeInstructions`) |
| `permissions` | `edit` (`folder` or `none`), `exec`, `web`: turned into Claude's allowed and denied tools and into Codex's permission answers |
| `blocks` | `defineBlock({ description, visible, schema, example })`: one MCP tool per block, served by the `ui` server |
| `actions` | Tasks: `label`, `description`, `prompt` (the brief that opens the task's session) and `cost` (`light`, `medium`, `heavy`) |
| `path` | The optional guided order of action ids (the "Recorrido") |
| `mcp`, `ui`, `locales` | Extra MCP servers, the harness's UI and its strings |

## Checks

- Block and action names follow fixed patterns. `choices` and `save_note` are reserved: every harness gets them as core blocks.
- Every id in `path` must be an action, once; reference ids are unique.
- `resolveInHarness` refuses any path that leaves the harness folder: instructions, seed, logo and every action's prompt.

## Where to look

- `packages/harness-sdk/src/index.ts`: the schema, `defineHarness`, `loadHarness`, `resolveInHarness`.
- `packages/harness-sdk/src/block.ts` and `core-blocks.ts`: blocks and the core blocks.
- `harnesses/demo/harness.config.ts`: a complete manifest.
```

`docs/architecture/engines.md`:
```md
# Engines

An engine is an official AI command-line tool the person already pays for. Human Harness uses their subscription through that tool: no API keys.

## The registry

`packages/engines/src/index.ts` describes each engine: its legal status (`allowed`, `pending`, `excluded`) with the source and date, the plan it requires, where data goes, how to detect it (`detect.binary`, `versionArgs`, `minVersion`), its transport and its setup commands. `availableEngines` drops the excluded ones, and the pending ones outside development.

## Two transports

- **Claude** (`packages/runtime/src/claude-cli.ts`): one `claude -p` process per turn with `--output-format stream-json`. A new session starts with `--session-id <uuid>`, later turns use `--resume`. Tools come from the manifest's permissions (`--allowedTools`, `--disallowedTools`), our MCP servers from `--mcp-config` with `--strict-mcp-config`, reference folders from `--add-dir`.
- **Codex** (`packages/runtime/src/acp.ts`): the bundled `codex-acp` adapter speaks the Agent Client Protocol. One long-lived process; `session/new`, `session/prompt`, `session/cancel`, `session/close`. Permission requests are answered from the manifest without asking the person.

## Getting an engine ready

Settings → Engine runs the steps in order, each decided by a status check (`packages/shell/src/main/engine-status.ts`): the legal notice, install (Claude's official installer), update when below `minVersion`, sign in (the tool's own login, in the browser), and a tiny test prompt. The app finds the tool through the login shell's `PATH` (`engine-command.ts`). `~/.humanharness/engines.json` keeps the accepted notice and the last successful test, never credentials.

## Compliance

- Only the official tools, unmodified.
- The app never reads `~/.claude` or `~/.codex`, and never adds or removes authentication environment variables.
- `claude auth status` prints the account's email: the app reads only `loggedIn` from it.
```

`docs/architecture/turn.md`:
```md
# A turn end to end

A turn is one message from the person and the agent's complete answer. It crosses five pieces, each in its own package.

1. **Screen** (`packages/ui`): `ChatView` sends the message through the `HarnessClient` contract (`client.send`, or `client.choose` for an option of a `choices` block). The preload (`packages/shell/src/preload/index.ts`) turns each call into IPC.
2. **Main process** (`packages/shell/src/main`): the IPC handler passes it to the `TaskManager` (`task-manager.ts`), which decides whether it starts a task or follows up the current one and builds a new task's first message (`task-prompts.ts`). `TurnController` (`turn-controller.ts`) logs the message, starts the runtime if needed and runs the turn.
3. **Runtime** (`packages/runtime/src/runtime.ts`): saves the folder in the history, then runs the turn through the engine's transport. It opens a private local socket (the bridge) for blocks.
4. **Engine tool**: `claude -p` or Codex through ACP. When the agent calls one of our tools, the `ui` MCP server (`packages/blocks/src/ui-server.ts`) validates it and forwards it over the bridge.
5. **Back as events** (`packages/runtime/src/events.ts`): `text`, `paragraph`, `activity`, `block`, `limits`, `usage`, and exactly one `done`. The main process saves the answer in `.harness/chats/main.jsonl` and the tokens in `.harness/usage.jsonl`, then sends the events to the window.

## When it goes wrong

- `done` carries an error code (`engine-not-installed`, `session-expired`, `out-of-quota`, `agent-crashed`, `cancelled`, `outdated-version`, `notice-required`); the screen shows a card with a way to fix it.
- If the agent crashes mid-turn, the runtime puts the folder back as it was before the message.
- Stop cancels the turn: Claude's process group gets SIGTERM, then SIGKILL; Codex gets `session/cancel`.
```

`docs/architecture/blocks.md`:
```md
# Blocks

Blocks let the agent show structured pieces of interface instead of loose text.

- A harness declares blocks in its manifest with `defineBlock`. A visible block becomes a `show_<name>` tool and is drawn by the React component the harness registers under that name; a state-only block becomes `update_<name>` and feeds the side panel.
- Every harness also gets two core blocks: `choices` (visible: two to four ways to continue, which move the task along) and `save_note` (hidden: the summary that closes a task; the app writes it, never the agent).
- `packages/blocks/src/ui-server.ts` is an MCP server with one tool per block. It checks the arguments against the block's schema and forwards valid calls to the runtime through the bridge (`bridge.ts`): a socket in a private folder, with a random token per runtime.
- The managed section of `AGENTS.md` lists every tool with its description, an example and its JSON schema (`packages/workspace/src/instructions.ts`).
- The runtime turns each forwarded call into a `block` event. The screen draws it with the registered component (`packages/ui/src/Message.tsx`); `choices` is drawn by the core (`ChoicesBlock.tsx`), and a pick goes back to the main process through `client.choose`.
- Calls to our own tools never show as activity: Claude's `mcp__ui__*` and Codex's `ui` server calls are hidden.
```

`docs/architecture/context.md`:
```md
# Context and memory

Long-term memory belongs to the harness; short-term memory belongs to the engine.

## One session per task

- A task is one topic or unit of work: a manifest action, or a free question.
- The app drives the flow (`packages/shell/src/main/task-manager.ts`): idle → running → waiting → closing → idle. A message while waiting follows up in the same session. Picking "next" or another topic closes the current task.
- Closing sends one last turn in the same session asking the agent to call `save_note`. The app validates the note and writes `.harness/notes/<action>.md` (`packages/workspace/src/notes.ts`). Then the session is dropped: Claude never resumes it, Codex gets `session/close`.
- Cancel, a failed first turn, an engine switch or quitting end the task without a note and mark it unfinished.
- The state lives in `.harness/tasks.json` (`packages/shell/src/main/task-store.ts`).

## What a new session gets

- The stable instructions: `AGENTS.md` with its managed section. It doesn't change between sessions, so the engine can reuse its cached prefix.
- The first message: the task's brief plus the notes index (`packages/workspace/src/notes-index.ts`): what was covered and the decisions so far, newest first, about 1,500 tokens at most. Older notes keep only their title and path; the agent opens a note with its read tool when it needs the details.

## Measuring

`.harness/usage.jsonl` records each turn's tokens with its `task` and `phase` (`run` or `close`).

## Engine switch

The chat is archived, the task state resets, the notes stay: the next task on the new engine gets the same index.
```

`docs/architecture/history.md`:
```md
# Folder and history

- The person's folder is visible and theirs. The app prepares it (`prepareFolder`), writes the instructions there and keeps its own files under `.harness/`: chats, usage, tasks and notes.
- Every change is recorded in an invisible local git history kept outside the folder (`packages/workspace/src/history.ts`, built on isomorphic-git). Its data lives in the app's data folder, one per folder (`historyDir` in `packages/shell/src/main/config.ts`), so cloud sync never touches it.
- The runtime commits before each message ("Before message") and after the turn ("Turn: …"). If the agent crashes mid-turn, it restores the point before the message. A saved note is committed as "Note: …".
- The history skips `.harness/` except `.harness/notes/`, and skips the generated `AGENTS.md` and the engine's own instructions file.
- History → "Go back to this point" makes the tracked files look as they did then and records that as a new commit, so it can be undone as well. It is refused while a turn runs.
```

- [ ] **Step 2: Check the docs against the code**

Run: `git ls-files packages | grep -E "task-manager.ts|task-prompts.ts|task-store.ts|notes.ts|notes-index.ts|ui-server.ts|bridge.ts|instructions.ts|Message.tsx|ChoicesBlock.tsx|engine-status.ts|engine-command.ts|history.ts|config.ts|block.ts|core-blocks.ts|events.ts|preload/index.ts"`
Expected: every file the docs name is listed.

Run: `grep -rn "export function historyDir\|export async function prepareFolder\|export function availableEngines\|export async function writeInstructions" packages`
Expected: one definition each.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture
git commit -m "docs: curated architecture docs for the explainer"
```

### Task 23: The demo becomes the architecture explainer

**Files:**
- Modify: `harnesses/demo/harness.config.ts`, `harnesses/demo/agent/AGENTS.md`, `harnesses/demo/agent/seed/README.md`, `harnesses/demo/locales/es.json`, `harnesses/demo/locales/en.json`, `harnesses/demo/ui/App.tsx`, `harnesses/demo/package.json`, `harnesses/demo/README.md`
- Create: `harnesses/demo/agent/tasks/{manifest,engines,turn,blocks,context,history}.md`, `harnesses/demo/ui/DiagramBlock.tsx`, `harnesses/demo/ui/FilesBlock.tsx`, `harnesses/demo/ui/demo.css`
- Create: `harnesses/demo/test/manifest.test.ts`, `harnesses/demo/test/blocks.test.tsx`
- Delete: `harnesses/demo/ui/NoteCard.tsx`, `harnesses/demo/agent/tasks/tidy.md`
- Modify: `vitest.config.ts`, `tsconfig.json`, `README.md`

- [ ] **Step 1: Let the demo have tests**

In `vitest.config.ts`, replace the `include` line with:
```ts
    include: ["packages/*/test/**/*.test.{ts,tsx}", "harnesses/*/test/**/*.test.{ts,tsx}"],
```
In `tsconfig.json`, replace the `include` line with:
```json
  "include": ["packages/*/src", "packages/*/test", "packages/fake-agent/fixtures", "harnesses/*/*.ts", "harnesses/*/ui", "harnesses/*/test"]
```
Replace `harnesses/demo/package.json` with:
```json
{
  "name": "@humanharness/harness-demo",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@humanharness/harness-sdk": "workspace:*",
    "@humanharness/ui": "workspace:*",
    "react": "^19.3.0",
    "react-i18next": "^17.0.16",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@humanharness/i18n": "workspace:*",
    "@testing-library/react": "^16.3.3",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "happy-dom": "^20.14.6",
    "react-dom": "^19.3.0"
  }
}
```
Run: `corepack pnpm install`
Expected: links only (the versions are already in the lockfile).

- [ ] **Step 2: Failing tests**

Create `harnesses/demo/test/manifest.test.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allBlocks, blockToolName, loadHarness, resolveInHarness } from "@humanharness/harness-sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.resolve(here, "../harness.config.ts");
const REPO = path.resolve(here, "../../..");

describe("demo manifest", () => {
  it("is a read-only explainer of the app's own source", async () => {
    const h = await loadHarness(CONFIG);
    expect(h.permissions).toEqual({ edit: "none", exec: false, web: false });
    expect(h.folder.references).toEqual([{ id: "source", label: { es: "Código de Human Harness", en: "Human Harness source" }, default: "app-source" }]);
    const blocks = allBlocks(h);
    expect(Object.entries(blocks).map(([name, b]) => blockToolName(name, b))).toEqual(["show_choices", "save_note", "show_diagram", "show_files"]);
  });

  it("walks six topics in order, each brief starting from its curated doc", async () => {
    const h = await loadHarness(CONFIG);
    expect(h.path).toEqual(["manifest", "engines", "turn", "blocks", "context", "history"]);
    expect(Object.keys(h.actions)).toEqual(h.path);
    for (const id of h.path!) {
      const brief = fs.readFileSync(resolveInHarness(h, h.actions[id].prompt), "utf8");
      expect(brief).toMatch(/^# Topic: /);
      expect(brief).toContain(`docs/architecture/${id}.md`);
      expect(brief).toContain("{{notesIndex}}");
      expect(fs.existsSync(path.join(REPO, "docs", "architecture", `${id}.md`))).toBe(true);
      expect(h.actions[id].description?.es).toBeTruthy();
    }
  });

  it("has the same strings in Spanish and English", () => {
    const keys = (o: Record<string, unknown>, prefix = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && v !== null ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]));
    const read = (l: string) => JSON.parse(fs.readFileSync(path.join(here, "..", "locales", `${l}.json`), "utf8")) as Record<string, unknown>;
    expect(keys(read("es")).sort()).toEqual(keys(read("en")).sort());
  });
});
```

Create `harnesses/demo/test/blocks.test.tsx`:
```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "@humanharness/i18n";
import en from "../locales/en.json";
import es from "../locales/es.json";
import { DiagramBlock } from "../ui/DiagramBlock";
import { FilesBlock } from "../ui/FilesBlock";

afterEach(cleanup);

async function renderIn(language: "es" | "en", ui: ReactElement) {
  const i18n = await createI18n(language, { es, en });
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}
const actions = (open: (path: string) => Promise<boolean> = async () => true) => ({ respond: () => true, choose: () => true, open, active: true });

describe("DiagramBlock", () => {
  it("draws the boxes in order and lists the other edges under them", async () => {
    const data = {
      title: "A turn",
      nodes: [{ id: "ui", label: "Screen", detail: "ui" }, { id: "shell", label: "Main process" }, { id: "rt", label: "Runtime" }],
      edges: [{ from: "ui", to: "shell" }, { from: "shell", to: "rt" }, { from: "rt", to: "ui", label: "events come back" }],
    };
    await renderIn("en", <DiagramBlock data={data} {...actions()} />);
    const figure = screen.getByRole("figure", { name: "A turn" });
    expect([...figure.querySelectorAll(".demo-node strong")].map((n) => n.textContent)).toEqual(["Screen", "Main process", "Runtime"]);
    expect(screen.getByText("ui")).toBeTruthy();
    expect(screen.getByText("Runtime → Screen: events come back")).toBeTruthy();
  });

  it("shows nothing for malformed data", async () => {
    const { container } = await renderIn("en", <DiagramBlock data={{ nodes: "x" }} {...actions()} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("FilesBlock", () => {
  it("lists each file with its role and opens it in the editor", async () => {
    const open = vi.fn(async () => true);
    await renderIn("es", <FilesBlock data={{ files: [{ path: "packages/runtime/src/runtime.ts", role: "elige el transporte" }] }} {...actions(open)} />);
    expect(screen.getByRole("article", { name: "Dónde está en el código" })).toBeTruthy();
    expect(screen.getByText("elige el transporte")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Abrir packages/runtime/src/runtime.ts en el editor" }));
    expect(open).toHaveBeenCalledWith("packages/runtime/src/runtime.ts");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says when a file can't be opened", async () => {
    await renderIn("en", <FilesBlock data={{ files: [{ path: "x.md", role: "r" }] }} {...actions(async () => false)} />);
    fireEvent.click(screen.getByRole("button", { name: "Open x.md in the editor" }));
    expect((await screen.findByRole("alert")).textContent).toBe("I couldn't open x.md.");
  });
});
```

Run: `corepack pnpm vitest run harnesses/demo`
Expected: FAIL (the demo still has notes, `tidy`, no `path`, no `diagram`/`files` components).

- [ ] **Step 3: Manifest, instructions and briefs**

Replace `harnesses/demo/harness.config.ts` with:
```ts
import { z } from "zod";
import { defineBlock, defineHarness } from "@humanharness/harness-sdk";

const diagram = defineBlock({
  description:
    "Shows a flow diagram: 2 to 7 boxes (nodes) in order, joined by arrows, and the edges that don't join neighbours listed under them. Use it at most once per answer, when a flow helps.",
  visible: true,
  schema: z.object({
    title: z.string().min(1).max(80).optional(),
    nodes: z.array(z.object({ id: z.string().min(1).max(40), label: z.string().min(1).max(40), detail: z.string().max(60).optional() })).min(2).max(7),
    edges: z.array(z.object({ from: z.string().min(1), to: z.string().min(1), label: z.string().max(120).optional() })).max(10),
  }),
  example: {
    title: "A turn",
    nodes: [
      { id: "ui", label: "Screen", detail: "ui" },
      { id: "shell", label: "Main process", detail: "shell · IPC" },
    ],
    edges: [{ from: "ui", to: "shell" }, { from: "shell", to: "ui", label: "comes back as events" }],
  },
});

const files = defineBlock({
  description:
    "Lists the files where what you explained lives, each with a one-line role, so the person can open and check them. Paths are relative to the reference folder.",
  visible: true,
  schema: z.object({ files: z.array(z.object({ path: z.string().min(1).max(300), role: z.string().min(1).max(120) })).min(1).max(8) }),
  example: { files: [{ path: "packages/runtime/src/runtime.ts", role: "picks the transport and emits events" }] },
});

const topic = (id: string, es: string, en: string, descEs: string, descEn: string) => ({
  label: { es, en },
  description: { es: descEs, en: descEn },
  prompt: `./agent/tasks/${id}.md`,
  cost: "medium" as const,
});

export default defineHarness({
  id: "demo",
  name: { es: "Demo", en: "Demo" },
  core: "^0.1.0",
  languages: ["es", "en"],
  engines: ["claude", "codex"],
  folder: {
    suggested: "Documents/Human Harness Demo",
    seed: "./agent/seed",
    references: [{ id: "source", label: { es: "Código de Human Harness", en: "Human Harness source" }, default: "app-source" }],
  },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: { diagram, files },
  actions: {
    manifest: topic("manifest", "El manifiesto", "The manifest", "Qué declara un harness en harness.config.ts y qué hace el código base con eso.", "What a harness declares in harness.config.ts and what the core does with it."),
    engines: topic("engines", "Motores", "Engines", "Cómo se detecta, instala y conecta Claude o Codex sin claves de API.", "How Claude or Codex is detected, installed and connected without API keys."),
    turn: topic("turn", "Un turno de punta a punta", "A turn end to end", "Desde que escribís hasta que aparece la respuesta en pantalla.", "From typing to the answer on screen."),
    blocks: topic("blocks", "Bloques", "Blocks", "Cómo la IA muestra tarjetas y opciones en vez de texto suelto.", "How the AI shows cards and options instead of loose text."),
    context: topic("context", "Contexto y memoria", "Context and memory", "Qué se manda al motor en cada turno y qué queda guardado.", "What goes to the engine each turn and what is kept."),
    history: topic("history", "Carpeta e historial", "Folder and history", "Cómo se registra cada cambio y cómo se vuelve atrás.", "How every change is recorded and how to go back."),
  },
  path: ["manifest", "engines", "turn", "blocks", "context", "history"],
  tagline: { es: "Cómo funciona Human Harness", en: "How Human Harness works" },
  author: "Marco Zanger",
});
```

Replace `harnesses/demo/agent/AGENTS.md` with:
```md
# Human Harness explainer

You explain how Human Harness works to a developer who cloned its repository. The source code is in the reference folder listed below: read it, never change it. The person's own folder only holds the app's notes.

## How to answer

- Start from the curated doc for the topic in `docs/architecture/` of the reference folder, then check the code it points to. Read at most about 8 files per answer.
- Explain in short paragraphs. Name only files and functions you actually read; never invent them.
- When a flow helps, call `show_diagram` once (2 to 7 boxes).
- Always call `show_files` with the files that back your answer: paths relative to the reference folder, each with a one-line role.
- End every answer with `show_choices`: one or two options to go deeper (`followUp`), one to a related topic (`action`, with its id: manifest, engines, turn, blocks, context, history), and one with `next: true` to continue the guided path.
- You cannot change files. If the person asks for a change, explain where it would go.
```

Replace `harnesses/demo/agent/seed/README.md` with:
```md
This folder belongs to the Human Harness demo. The app keeps what each topic made clear in `.harness/notes/`; the code it explains stays read-only in the repository.
```

Create `harnesses/demo/agent/tasks/manifest.md`:
```md
# Topic: the manifest

Explain what a harness declares in `harness.config.ts` and what the core does with each part. Answer in {{language}}.

1. Read `docs/architecture/manifest.md` in the reference folder first.
2. Then, only as needed: `packages/harness-sdk/src/index.ts`, `packages/harness-sdk/src/core-blocks.ts`, `harnesses/demo/harness.config.ts`.
3. Read at most 8 files.

Cover what `defineHarness` checks, blocks, actions with their briefs and the guided path, reference folders and permissions.

{{notesIndex}}
```
Create `harnesses/demo/agent/tasks/engines.md`:
```md
# Topic: engines

Explain how Human Harness finds, sets up and talks to Claude and Codex with the person's own subscription. Answer in {{language}}.

1. Read `docs/architecture/engines.md` in the reference folder first.
2. Then, only as needed: `packages/engines/src/index.ts`, `packages/shell/src/main/engine-status.ts`, `packages/runtime/src/claude-cli.ts`, `packages/runtime/src/acp.ts`.
3. Read at most 8 files.

Cover the registry and its legal status, the two transports, the setup steps and what the app never touches.

{{notesIndex}}
```
Create `harnesses/demo/agent/tasks/turn.md`:
```md
# Topic: a turn end to end

Explain what happens from the moment the person sends a message until the answer is on screen. Answer in {{language}}.

1. Read `docs/architecture/turn.md` in the reference folder first.
2. Then, only as needed: `packages/ui/src/ChatView.tsx`, `packages/shell/src/main/turn-controller.ts`, `packages/runtime/src/runtime.ts`, `packages/runtime/src/claude-cli.ts`, `packages/blocks/src/ui-server.ts`.
3. Read at most 8 files.

A diagram of the five pieces helps here.

{{notesIndex}}
```
Create `harnesses/demo/agent/tasks/blocks.md`:
```md
# Topic: blocks

Explain how the agent shows cards and options instead of loose text. Answer in {{language}}.

1. Read `docs/architecture/blocks.md` in the reference folder first.
2. Then, only as needed: `packages/harness-sdk/src/block.ts`, `packages/harness-sdk/src/core-blocks.ts`, `packages/blocks/src/ui-server.ts`, `packages/blocks/src/bridge.ts`, `packages/ui/src/Message.tsx`.
3. Read at most 8 files.

Cover how a block is declared, how the agent calls it, how it reaches the screen, and the two core blocks.

{{notesIndex}}
```
Create `harnesses/demo/agent/tasks/context.md`:
```md
# Topic: context and memory

Explain what goes to the engine in each session and what the app keeps. Answer in {{language}}.

1. Read `docs/architecture/context.md` in the reference folder first.
2. Then, only as needed: `packages/shell/src/main/task-manager.ts`, `packages/shell/src/main/task-prompts.ts`, `packages/workspace/src/notes.ts`, `packages/workspace/src/notes-index.ts`.
3. Read at most 8 files.

Cover one session per task, the closing note, the notes index and why it goes in the first message.

{{notesIndex}}
```
Create `harnesses/demo/agent/tasks/history.md`:
```md
# Topic: folder and history

Explain how every change in the person's folder is recorded and how they go back. Answer in {{language}}.

1. Read `docs/architecture/history.md` in the reference folder first.
2. Then, only as needed: `packages/workspace/src/history.ts`, `packages/workspace/src/folder.ts`, `packages/runtime/src/runtime.ts`, `packages/shell/src/main/config.ts`.
3. Read at most 8 files.

Cover where the history lives, when it commits, what it skips and how going back works.

{{notesIndex}}
```
Delete the old brief: `git rm harnesses/demo/agent/tasks/tidy.md`.

- [ ] **Step 4: Strings, blocks and the app**

Replace `harnesses/demo/locales/es.json` with:
```json
{
  "startTitle": "¿Qué parte querés entender?",
  "startIntro": "Elegí un tema. La IA lee el código de esta carpeta y te lo explica con diagramas y los archivos donde está cada cosa.",
  "faq": {
    "ownHarness": "¿Cómo armo mi propio harness?",
    "conversation": "¿Dónde se guarda la conversación?",
    "newEngine": "¿Cómo agrego un motor nuevo?"
  },
  "hint": "La IA explica leyendo el código de esta carpeta. Puede equivocarse: cada respuesta trae los archivos para que lo verifiques.",
  "diagram": "Diagrama",
  "files": "Dónde está en el código",
  "open": "Abrir",
  "openLabel": "Abrir {{path}} en el editor",
  "openFailed": "No pude abrir {{path}}."
}
```
Replace `harnesses/demo/locales/en.json` with:
```json
{
  "startTitle": "Which part do you want to understand?",
  "startIntro": "Pick a topic. The AI reads the code in this folder and explains it with diagrams and the files where each thing lives.",
  "faq": {
    "ownHarness": "How do I build my own harness?",
    "conversation": "Where is the conversation saved?",
    "newEngine": "How do I add a new engine?"
  },
  "hint": "The AI explains by reading the code in this folder. It can be wrong: every answer lists the files so you can check.",
  "diagram": "Diagram",
  "files": "Where it is in the code",
  "open": "Open",
  "openLabel": "Open {{path}} in the editor",
  "openFailed": "I couldn't open {{path}}."
}
```

Create `harnesses/demo/ui/DiagramBlock.tsx`:
```tsx
import type { BlockProps } from "@humanharness/ui";
import { useTranslation } from "react-i18next";

interface DiagramNode {
  id: string;
  label: string;
  detail?: string;
}
interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

const isNode = (n: unknown): n is DiagramNode => !!n && typeof (n as DiagramNode).id === "string" && typeof (n as DiagramNode).label === "string";
const isEdge = (e: unknown): e is DiagramEdge => !!e && typeof (e as DiagramEdge).from === "string" && typeof (e as DiagramEdge).to === "string";

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function Back() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M19 5v6a4 4 0 0 1-4 4H5M9 11l-4 4 4 4" />
    </svg>
  );
}

/** `show_diagram`: boxes in order joined by arrows; edges that don't join neighbours are listed under them. */
export function DiagramBlock({ data }: BlockProps) {
  const { t } = useTranslation("harness");
  const nodes = Array.isArray(data?.nodes) ? (data.nodes as unknown[]).filter(isNode) : [];
  const edges = Array.isArray(data?.edges) ? (data.edges as unknown[]).filter(isEdge) : [];
  if (nodes.length === 0) return null;
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const labelOf = (id: string) => nodes[order.get(id) ?? -1]?.label ?? id;
  const others = edges.filter((e) => order.get(e.to) !== (order.get(e.from) ?? -2) + 1);
  const title = typeof data?.title === "string" && data.title ? data.title : t("diagram");
  return (
    <figure className="demo-diagram" aria-label={title}>
      <figcaption className="demo-kicker">{title}</figcaption>
      <ol className="demo-nodes">
        {nodes.map((n, i) => (
          <li key={n.id} className="demo-node-item">
            {i > 0 && <Arrow />}
            <span className="demo-node">
              <strong>{n.label}</strong>
              {n.detail && <span>{n.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
      {others.length > 0 && (
        <ul className="demo-edges">
          {others.map((e, i) => (
            <li key={i}>
              <Back />
              {`${labelOf(e.from)} → ${labelOf(e.to)}${e.label ? `: ${e.label}` : ""}`}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
```

Create `harnesses/demo/ui/FilesBlock.tsx`:
```tsx
import type { BlockProps } from "@humanharness/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface FileRef {
  path: string;
  role: string;
}

const isFile = (f: unknown): f is FileRef => !!f && typeof (f as FileRef).path === "string" && typeof (f as FileRef).role === "string";

/** `show_files`: where the answer lives in the code, each file with an "Open" button (the app checks the path). */
export function FilesBlock({ data, open }: BlockProps) {
  const { t } = useTranslation("harness");
  const [failed, setFailed] = useState<string | null>(null);
  const files = Array.isArray(data?.files) ? (data.files as unknown[]).filter(isFile) : [];
  if (files.length === 0) return null;
  const openFile = (file: string) => {
    setFailed(null);
    open(file).then(
      (ok) => setFailed(ok ? null : file),
      () => setFailed(file),
    );
  };
  return (
    <article className="demo-files" aria-label={t("files")}>
      <span className="demo-kicker">{t("files")}</span>
      <ul>
        {files.map((f) => (
          <li key={f.path}>
            <code>{f.path}</code>
            <span>{f.role}</span>
            <button type="button" aria-label={t("openLabel", { path: f.path })} onClick={() => openFile(f.path)}>
              {t("open")}
            </button>
          </li>
        ))}
      </ul>
      {failed && (
        <p role="alert" className="hh-warn">
          {t("openFailed", { path: failed })}
        </p>
      )}
    </article>
  );
}
```

Create `harnesses/demo/ui/demo.css`:
```css
/* The demo's own blocks. Colours only through the core's --hh-* tokens. */
.demo-kicker { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--hh-muted); }
.demo-diagram { margin: 0; display: grid; gap: 10px; padding: 12px 14px; background: var(--hh-surface); border: 1px solid var(--hh-line); border-radius: 12px; }
.demo-nodes { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.demo-node-item { flex: 1 1 0; min-width: 96px; display: flex; align-items: center; gap: 6px; }
.demo-node-item svg { flex: none; color: var(--hh-muted); }
.demo-node { flex: 1; display: grid; gap: 2px; padding: 8px 10px; border: 1px solid var(--hh-line-strong); border-radius: 8px; background: var(--hh-surface); }
.demo-node strong { font-size: 12px; }
.demo-node span { font-size: 11px; color: var(--hh-muted); }
.demo-edges { list-style: none; margin: 0; padding: 0 0 0 4px; display: grid; gap: 4px; font-size: 12px; color: var(--hh-slate); }
.demo-edges li { display: flex; align-items: center; gap: 8px; }
.demo-files { display: grid; background: var(--hh-surface); border: 1px solid var(--hh-line); border-radius: 12px; }
.demo-files .demo-kicker { padding: 10px 12px 6px; }
.demo-files ul { list-style: none; margin: 0; padding: 0; }
.demo-files li { display: flex; align-items: center; gap: 10px; padding: 7px 12px; border-top: 1px solid var(--hh-line); }
.demo-files li span { flex: 1; font-size: 12px; color: var(--hh-muted); }
.demo-files button { height: 24px; padding: 0 9px; font-size: 12px; }
.demo-files [role="alert"] { padding: 0 12px 10px; }
```

Replace `harnesses/demo/ui/App.tsx` with:
```tsx
import { type HarnessClient, HarnessApp } from "@humanharness/ui";
import en from "../locales/en.json";
import es from "../locales/es.json";
import { DiagramBlock } from "./DiagramBlock";
import { FilesBlock } from "./FilesBlock";
import "./demo.css";

const locales = { es, en };
const blocks = { diagram: DiagramBlock, files: FilesBlock };
const startView = { title: "startTitle", intro: "startIntro", faq: ["faq.ownHarness", "faq.conversation", "faq.newEngine"], hint: "hint" };

export default function App({ client }: { client: HarnessClient }) {
  return <HarnessApp client={client} blocks={blocks} locales={locales} startView={startView} />;
}
```
Delete the note card: `git rm harnesses/demo/ui/NoteCard.tsx`.

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run harnesses/demo`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 6: READMEs**

Replace `harnesses/demo/README.md` with:
```md
# Demo harness: the architecture explainer

The demo explains Human Harness to developers who clone this repository, and exercises the core's flow and context management. It reads the repository read-only and keeps what each topic made clear in the user's folder. It runs in development only (it is never signed or distributed):

    corepack pnpm app:dev

## Files

| File | What it is |
|---|---|
| `harness.config.ts` | The manifest: read-only permissions (`edit: "none"`, no commands, no web), the repository as a reference folder (`"app-source"`), the `diagram` and `files` blocks, six topics as actions with their briefs, and the guided path. |
| `agent/AGENTS.md` | How the explainer answers: start from the curated doc, read at most about 8 files, end with `show_choices`. The core adds the managed section (language, the tools, the reference folder). |
| `agent/tasks/*.md` | One brief per topic: the first message of the topic's session. `{{language}}` and `{{notesIndex}}` are filled by the app. |
| `agent/seed/` | Copied into the user's folder the first time. |
| `ui/App.tsx` | Mounts `HarnessApp` with the two block components and the start view's strings. |
| `ui/DiagramBlock.tsx`, `ui/FilesBlock.tsx`, `ui/demo.css` | The demo's blocks. |
| `locales/es.json`, `locales/en.json` | The demo's strings (start view, blocks). |
| `test/` | The manifest and the block components. |

## Topics

`manifest`, `engines`, `turn`, `blocks`, `context`, `history`, in that order. Each brief points first at `docs/architecture/<topic>.md`, a short curated doc in the repository, then at the code. Each topic runs in its own engine session; choosing "next" closes it, the agent saves a note through the core `save_note` block, and the next topic starts from the notes index.

## Blocks

- `diagram` (visible, `show_diagram`): nodes in order and extra edges.
- `files` (visible, `show_files`): paths relative to the repository with a one-line role; "Abrir" opens the file in the default editor through the app, which only opens files inside the reference folder or the user's folder.
- Core: `choices` (how to continue) and `save_note` (the closing note).
```

In `README.md`:
- Replace the status paragraph with:
```md
> **Status:** early development. The Node foundations (plan 1), the desktop app (plans 2a and 2b) and the flow and context management (plan 3) are in place: harnesses run their actions as tasks with one engine session each, keep notes in the user's folder and start every session from them. The demo harness is an architecture explainer for developers. Design: [`docs/superpowers/specs/`](docs/superpowers/specs/). Roadmap: [`docs/superpowers/plans/`](docs/superpowers/plans/).
```
- In the repository layout, replace `  demo/          minimal harness used by the tests` with:
```
  demo/          architecture explainer (development only)
```
  and add after `docs/            specs, plans and spikes`:
```
docs/architecture/  short curated docs the explainer starts from
```
- In "Create a harness", replace the `actions` bullet with:
```md
   - `actions`: the tasks your harness offers, each with a `label`, an optional `description`, a `prompt` (a brief in your harness folder; `{{language}}` and `{{notesIndex}}` are filled in) and a `cost` of `light`, `medium` or `heavy`. Heavy ones may ask the user first when their plan is close to its limit. Each task runs in its own engine session and ends with a note in `.harness/notes/`.
   - `path` (optional): the order of the guided path shown in the side panel.
   - `folder.references` (optional): folders the AI may read but never change.
```
  replace step 3 with:
```md
3. Write `agent/AGENTS.md`: what the AI does and when it calls each block's tool (`show_<block>` / `update_<block>`). Every harness also has two core tools: `show_choices`, which ends each answer with ways to continue, and `save_note`, which the app asks for when a task closes.
```
  and replace step 4 with:
```md
4. Write `ui/App.tsx`: mount `HarnessApp` with a component per visible block, your locales and, for the work screen's start view, `startView` (keys of your strings for its title, intro, frequent questions and the line under the composer). State-only blocks and a right-hand panel (`stateBlocks`, `renderSide`) are still available.
```

- [ ] **Step 7: Check the app builds**

Run: `corepack pnpm app:build`
Expected: builds without errors (the renderer bundles `demo.css`).

- [ ] **Step 8: Commit**

```bash
git add -A harnesses/demo vitest.config.ts tsconfig.json README.md pnpm-lock.yaml
git commit -m "feat(demo): the demo becomes a read-only architecture explainer"
```

---

## Phase 7 — End to end

### Task 24: Playwright E2E with the fake agents

**Files:**
- Create: `packages/e2e/package.json`, `packages/e2e/playwright.config.ts`, `packages/e2e/README.md`, `packages/e2e/tests/helpers.ts`, `packages/e2e/tests/scripts.ts`, `packages/e2e/tests/flow.spec.ts`
- Modify: `package.json`, `.gitignore`, `tsconfig.json`

- [ ] **Step 1: The package**

Create `packages/e2e/package.json`:
```json
{
  "name": "@humanharness/e2e",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "corepack pnpm --filter @humanharness/shell build && playwright test"
  },
  "devDependencies": {
    "@humanharness/engines": "workspace:*",
    "@humanharness/fake-agent": "workspace:*",
    "@playwright/test": "1.63.0"
  }
}
```
Create `packages/e2e/playwright.config.ts`:
```ts
import { defineConfig } from "@playwright/test";

// One Electron app at a time: each test launches the built shell with its own folders.
export default defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.ts",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: "list",
  use: { trace: "retain-on-failure" },
});
```
Create `packages/e2e/README.md`:
```md
# End-to-end tests

Playwright drives the built desktop app (the demo harness) against the scripted fake agents in `packages/fake-agent`. No real engine, account or network is used.

    corepack pnpm e2e

The script builds the shell first. The app reads three development-only variables (a packaged app ignores them; see `packages/shell/src/main/test-hooks.ts`): `HH_TEST_USER_DATA` (its config folder), `HH_TEST_SHARED_DIR` (instead of `~/.humanharness`) and `HH_TEST_ENGINES` (the fake agents to run, which only receive `HH_FAKE_*` variables).

Each test works in `packages/e2e/.tmp/` (git-ignored), inside the repository: the app refuses folders under `/var` and `/private`, where macOS keeps the system's temporary files. On Linux CI, run it under `xvfb-run`.
```
In the root `package.json`, add to `scripts`:
```json
    "e2e": "corepack pnpm --filter @humanharness/e2e test",
```
Append to `.gitignore`:
```
packages/e2e/.tmp/
test-results/
playwright-report/
```
In `tsconfig.json`, replace the `include` line with:
```json
  "include": ["packages/*/src", "packages/*/test", "packages/fake-agent/fixtures", "packages/e2e/tests", "packages/e2e/playwright.config.ts", "harnesses/*/*.ts", "harnesses/*/ui", "harnesses/*/test"]
```
Run: `corepack pnpm install`
Expected: `@playwright/test` 1.63.0 is installed (no browsers are downloaded; Electron is the shell's own).

- [ ] **Step 2: Helpers and scripts**

Create `packages/e2e/tests/helpers.ts`:
```ts
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, type Page, _electron as electron } from "@playwright/test";
import { NOTICE_VERSION } from "@humanharness/engines";
import { type AcpScript, type ClaudeScript, fakeAcpCommand, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";

const here = path.dirname(fileURLToPath(import.meta.url));
export const shellDir = path.resolve(here, "../../shell");
/** The `electron` package exports the path of its binary. */
const electronBinary = createRequire(path.join(shellDir, "package.json"))("electron") as string;

export interface Sandbox {
  root: string;
  /** The user's folder. */
  folder: string;
  userData: string;
  sharedDir: string;
  /** fake-claude appends {argv, prompt} for every run here. */
  claudePrompts: string;
  /** fake-acp appends every request it gets here. */
  acpLog: string;
}

/** A configured app (Spanish, Claude) with both engines' notices accepted, in packages/e2e/.tmp/. */
export function makeSandbox(name: string): Sandbox {
  const root = path.resolve(here, "..", ".tmp", `${name}-${Date.now()}`);
  const s: Sandbox = {
    root,
    folder: path.join(root, "Work"),
    userData: path.join(root, "userData"),
    sharedDir: path.join(root, "shared"),
    claudePrompts: path.join(root, "claude-prompts.jsonl"),
    acpLog: path.join(root, "acp-log.jsonl"),
  };
  for (const dir of [s.folder, s.userData, s.sharedDir]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(s.userData, "config.json"), JSON.stringify({ language: "es", folder: s.folder, engineId: "claude" }));
  const now = new Date().toISOString();
  const ready = { notice: { version: NOTICE_VERSION, acceptedAt: now }, verifiedAt: now };
  fs.writeFileSync(path.join(s.sharedDir, "engines.json"), JSON.stringify({ version: 1, engines: { claude: ready, codex: ready } }));
  return s;
}

/** Launches the built shell with the fake agents in place of the engines. */
export async function launch(s: Sandbox, scripts: { claude: ClaudeScript; codex?: AcpScript }): Promise<{ app: ElectronApplication; page: Page }> {
  const engines = {
    claude: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(s.root, scripts.claude), HH_FAKE_PROMPTS: s.claudePrompts } },
    ...(scripts.codex
      ? { codex: { command: fakeAcpCommand(), env: { HH_FAKE_SCRIPT: writeScript(s.root, scripts.codex), HH_FAKE_LOG: s.acpLog } } }
      : {}),
  };
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== "ELECTRON_RENDERER_URL"));
  const app = await electron.launch({
    executablePath: electronBinary,
    args: [shellDir],
    env: { ...env, HH_TEST_USER_DATA: s.userData, HH_TEST_SHARED_DIR: s.sharedDir, HH_TEST_ENGINES: JSON.stringify(engines) },
  });
  return { app, page: await app.firstWindow() };
}

export function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
}

/** The session a fake-claude run used (`--session-id` for a new one, `--resume` to continue). */
export function sessionOf(argv: string[]): string {
  const flag = argv.includes("--resume") ? "--resume" : "--session-id";
  return argv[argv.indexOf(flag) + 1];
}
```

Create `packages/e2e/tests/scripts.ts`:
```ts
import { type AcpScript, type ClaudeScript, claudeTextLines } from "@humanharness/fake-agent";

/** A result line with usage, so usage.jsonl gets a record per turn. */
const result = {
  line: {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "",
    session_id: "fake-session",
    usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
  },
};
const ui = (tool: string, args: Record<string, unknown>) => ({ mcp: { server: "ui", tool, args } });
const choices = ui("show_choices", {
  options: [
    { label: "Profundizar en las acciones", followUp: "Contame más de las acciones." },
    { label: "Seguir el recorrido →", next: true },
  ],
});

/** Claude: answers the manifest topic with blocks, saves a note when the app closes the topic, answers engines. */
export const claudeScript: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    {
      // The closing turn's core prompt names the save_note tool; no brief does.
      match: "save_note",
      steps: [
        ui("save_note", {
          title: "El manifiesto",
          summary: ["defineHarness valida el manifiesto", "Las acciones traen su brief"],
          decisions: ["Una sesión por tema"],
          files: ["packages/harness-sdk/src/index.ts"],
          open: [],
        }),
        ...claudeTextLines("Guardé el resumen."),
        result,
      ],
    },
    {
      match: "# Topic: the manifest",
      steps: [
        ...claudeTextLines("El manifiesto declara todo el harness."),
        ui("show_diagram", {
          title: "Del manifiesto a la app",
          nodes: [
            { id: "config", label: "harness.config.ts" },
            { id: "sdk", label: "defineHarness", detail: "harness-sdk" },
            { id: "app", label: "La app", detail: "shell" },
          ],
          edges: [{ from: "config", to: "sdk" }, { from: "sdk", to: "app" }],
        }),
        ui("show_files", { files: [{ path: "packages/harness-sdk/src/index.ts", role: "valida el manifiesto" }] }),
        choices,
        result,
      ],
    },
    { match: "# Topic: engines", steps: [...claudeTextLines("Los motores se detectan en cada inicio."), choices, result] },
  ],
};

/** Codex: one answer to a free question. */
export const codexScript: AcpScript = {
  turns: [[{ update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Se guarda en .harness/chats." } } }, { stop: "end_turn" }]],
};
```

- [ ] **Step 3: The tests**

Create `packages/e2e/tests/flow.spec.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { launch, makeSandbox, readJsonl, sessionOf } from "./helpers";
import { claudeScript, codexScript } from "./scripts";

type Run = { argv: string[]; prompt: string };
const START = "¿Qué parte querés entender?";

test("a topic answered with blocks, then next: the note is saved and the next topic starts from it", async () => {
  const s = makeSandbox("flow");
  const { app, page } = await launch(s, { claude: claudeScript });
  try {
    await page.getByRole("button", { name: "Iniciar Demo" }).click();
    await page.getByRole("region", { name: START }).getByRole("button", { name: /El manifiesto/ }).click();
    await expect(page.getByText("El manifiesto declara todo el harness.")).toBeVisible();
    await expect(page.getByRole("figure", { name: "Del manifiesto a la app" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Abrir packages/harness-sdk/src/index.ts en el editor" })).toBeVisible();

    await page.getByRole("radio", { name: "Seguir el recorrido →" }).click();
    await expect(page.getByText("Los motores se detectan en cada inicio.")).toBeVisible();

    const note = fs.readFileSync(path.join(s.folder, ".harness", "notes", "manifest.md"), "utf8");
    expect(note).toContain('title: "El manifiesto"');
    expect(note).toContain("- defineHarness valida el manifiesto");

    const [first, close, second] = readJsonl<Run>(s.claudePrompts);
    expect(first.prompt).toContain("# Topic: the manifest");
    expect(first.prompt).not.toContain("## What we already covered");
    expect(close.prompt).toContain("save_note");
    expect(close.argv).toContain("--resume");
    expect(sessionOf(close.argv)).toBe(sessionOf(first.argv));
    expect(second.prompt).toContain("# Topic: engines");
    expect(second.prompt).toContain(
      "- El manifiesto (manifest): defineHarness valida el manifiesto; Las acciones traen su brief → .harness/notes/manifest.md",
    );
    expect(second.argv).toContain("--session-id");
    expect(sessionOf(second.argv)).not.toBe(sessionOf(first.argv));

    const tasks = JSON.parse(fs.readFileSync(path.join(s.folder, ".harness", "tasks.json"), "utf8"));
    expect(tasks.actions).toEqual({ manifest: "done" });
    expect(readJsonl<{ phase?: string }>(path.join(s.folder, ".harness", "usage.jsonl")).map((r) => r.phase)).toEqual(["run", "close", "run"]);
    await expect(page.getByRole("list", { name: "Lo que ya quedó claro" }).getByRole("button", { name: "El manifiesto" })).toBeVisible();
  } finally {
    await app.close();
  }
});

test("changing the engine keeps the notes, and the first task on the new engine starts from them", async () => {
  const s = makeSandbox("switch");
  const { app, page } = await launch(s, { claude: claudeScript, codex: codexScript });
  try {
    await page.getByRole("button", { name: "Iniciar Demo" }).click();
    await page.getByRole("region", { name: START }).getByRole("button", { name: /El manifiesto/ }).click();
    await expect(page.getByText("El manifiesto declara todo el harness.")).toBeVisible();
    await page.getByRole("radio", { name: "Seguir el recorrido →" }).click();
    await expect(page.getByText("Los motores se detectan en cada inicio.")).toBeVisible();

    await page.getByRole("button", { name: "Ajustes" }).click();
    await page.getByRole("tab", { name: "Motor" }).click();
    await page.getByRole("button", { name: /Codex/ }).first().click();
    await page.getByRole("button", { name: "Usar Codex" }).click();
    await page.getByRole("button", { name: "Listo" }).click();

    await expect(page.getByText(/Ahora usás Codex/)).toBeVisible();
    await expect(page.getByRole("list", { name: "Lo que ya quedó claro" }).getByRole("button", { name: "El manifiesto" })).toBeVisible();
    expect(fs.existsSync(path.join(s.folder, ".harness", "notes", "manifest.md"))).toBe(true);
    const tasks = JSON.parse(fs.readFileSync(path.join(s.folder, ".harness", "tasks.json"), "utf8"));
    expect(tasks).toMatchObject({ current: null, actions: { manifest: "done", engines: "unfinished" } });

    await page.getByPlaceholder("O preguntá algo…").fill("¿Dónde se guarda la conversación?");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByText("Se guarda en .harness/chats.")).toBeVisible();
    const prompt = readJsonl<{ method: string; params: { prompt: { text: string }[] } }>(s.acpLog).find((l) => l.method === "session/prompt");
    expect(prompt?.params.prompt[0].text).toContain("## Question\n¿Dónde se guarda la conversación?");
    expect(prompt?.params.prompt[0].text).toContain(
      "- El manifiesto (manifest): defineHarness valida el manifiesto; Las acciones traen su brief → .harness/notes/manifest.md",
    );
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 4: Run them**

Run: `corepack pnpm e2e`
Expected: the shell builds, then `2 passed`.

If a step fails, open the trace (`corepack pnpm --filter @humanharness/e2e exec playwright show-trace test-results/<test>/trace.zip`) before changing anything.

- [ ] **Step 5: Everything else still green**

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS (Vitest does not pick up `*.spec.ts` in `packages/e2e/tests`).

- [ ] **Step 6: Commit**

```bash
git add packages/e2e package.json .gitignore tsconfig.json pnpm-lock.yaml
git commit -m "test(e2e): Playwright drives the app against the fake agents (topic → note → next; engine switch)"
```

---

## Self-review notes (for the executor)

- **Spec coverage:** manifest prompts/path/references (Task 3); core blocks (Task 2) in `AGENTS.md` (Tasks 4, 10); notes store and index (Tasks 5–6); state machine, one session per task, closing turn, `session/close`, prompt filling, free questions, index in the first message (Tasks 8, 10, 13–15, 17); reference folders (Tasks 9, 16, 17); `usage.jsonl` task and phase (Task 11); engine switch (Task 13, E2E in Task 24); work screen (Tasks 18–21); demo (Tasks 22–23); tests at every level and E2E (Task 24).
- **Order:** every task leaves `corepack pnpm typecheck` and `corepack pnpm test` green; Task 3 keeps the demo's `tidy` action valid with a stub brief that Task 23 removes; the UI's flow mode only turns on for harnesses with actions, so the existing `HarnessApp` tests keep passing.
- **Checked while writing:** `@agentclientprotocol/sdk@1.8.0` types `request("session/close", { sessionId })` through its method map, and `AgentCapabilities.sessionCapabilities.close` exists; zod 4's `superRefine` returns the same schema type, so `z.output<typeof manifestSchema>` is unchanged.
- **If an assumption breaks:** if Playwright cannot start Electron from `args: [shellDir]`, pass `args: [path.join(shellDir, "out/main/index.js")]`. If the flow tests in Task 21 race the conversation load, the `startRegion` helper already waits until the topics are enabled; do the same before clicking a `FlowSide` step.
- **Not built, on purpose:** the mockup's "Leyó 7 archivos de packages/" summary line (the existing activity list stays), its back-chevron top bar with the tagline (the 2b top bar stays), and the "Resúmenes / Conversaciones" tabs of the notes panel.
