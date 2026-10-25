# Input Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A harness block may declare an `input` schema. The agent shows it with its `show_<name>` tool, the person answers it in a form (the core `InputForm`, or the harness's own component), and `client.respond(blockId, value)` brings the answer back. The main process checks it, may write it to a data collection (`saveTo`), marks it in the chat, and sends it to the agent as the next turn's message: a readable line plus the exact JSON. The agent can then mark parts of the person's text with the core `annotate` block. Mock recordings, `check` and `humanharness run` know input blocks too. A harness with no input block works exactly as today (D0 below).

**Architecture:**
- **Contract (harness-sdk).** `Block` gets `input`, `inputUi`, `submitLabel`, `skippable`, `display` and later `saveTo`. Two new modules hold the pure logic every side shares:
  - `input.ts`: field kinds inferred from zod (`inputFields`, `inputSpec`), as plain data the window and the terminal can draw.
  - `answer.ts`: block ids, `parseAnswer`, the readable line, the harness's `display` (time-boxed), the turn message (`answerMessage`) and its parser (`readAnswer`).
- **Ids and the pending input (shell main).**
  - `TurnController` stamps each input block event of a task's turn with `id = <task>:<turn>:<index>`. The id travels on the event to the window and into the chat log.
  - `TaskManager` records the last one as `tasks.json` → `current.pendingInput` while the turn runs, so the window enables its form as soon as the turn ends.
- **The way back.**
  - `TaskManager.respond(blockId, value)` runs as one `op()`: stale check, validation, checkpoint if due, `saveTo`, clear, mark the chat, then `askNow(message, display)`.
  - It answers in two steps: `accepted` (refused with field errors, or taken with the readable line) and `done` (the turn ended). IPC `hh:respond` returns `accepted` as a plain `RespondResult`, so field errors survive Electron's IPC.
- **The window (ui).**
  - `AppState.inputs` carries each input block's `InputSpec`.
  - `Blocks` wraps input blocks in an `InputHost`, which keeps the errors. It draws the harness's component (with `input` props) or the core `CoreInputBlock` + `InputForm`.
  - `AnnotateBlock` draws an answered text with its marks.
- **Mock and terminal (cli, fake-agent).**
  - A recorded turn may list `respond` answers, each with the turn it leads to; replay matches the answer's JSON.
  - `run` asks the fields at the prompt (`a`), and `run --record` writes them.
  - `check` validates every recorded value (`mock-input`).

**Tech Stack:**
- Unchanged: TypeScript, pnpm via corepack, Electron 44 + electron-vite 5, React 19, i18next, zod 4 (`instanceof` on `z.ZodString`/`ZodNumber`/`ZodEnum`/`ZodArray`/`ZodObject`/`ZodBoolean`, `maxLength`, `minValue`/`maxValue`, `options`, `element`, `unwrap()`), MCP SDK 1.32, Vitest + happy-dom, and Playwright with the fake agents.
- No new runtime dependency. The fake-agent package gets three dev dependencies for the e2e fixture's screen (Task 23).

Spec: `docs/superpowers/specs/2026-10-25-input-blocks-design.md` (source of truth; "§" numbers below refer to it). It builds on `2026-10-25-scopes-and-data-design.md`, implemented by plan `2026-10-25-scopes-and-data.md` on `feat/scopes-data`, which this branch stacks on.

---

## Conventions

**Code**
- Same as plans 1–3f and the scopes-and-data plan:
  - English everywhere (code, comments, docs);
  - packages export TS source;
  - extensionless imports;
  - tests in `packages/<name>/test/`;
  - one commit per task.
- React tests are `*.test.tsx` with `// @vitest-environment happy-dom` on the first line. Find elements by role and visible text.
- `@humanharness/ui` only imports **types** from other packages (`import type`). The UI's own small helpers (answer rows, choice options, marks) live in `packages/ui/src/`, never imported from the SDK at runtime.
- Colours only through `--hh-*` tokens. This plan adds one token, `--hh-highlight` (Task 17).

**Commands and git**
- The worktree is `/Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data`, already on branch `feat/input-blocks` (stacked on `feat/scopes-data`). Implement there.
- Run every `corepack pnpm …` command from the worktree root.
- Git: always `git -C <worktree> …`, one simple command per call. Never use bare `git stash`.
- Every commit message ends with these two lines, with a blank line before them:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7
  ```
- Every task ends with `corepack pnpm typecheck` and `corepack pnpm test` green before its commit.
  - Tasks that touch the shell's main process, the preload or the UI also run `corepack pnpm app:build`.
  - Task 23 runs `corepack pnpm e2e`.

**Compliance (core spec §5), restated for this plan**
- Never read `~/.claude`, `~/.codex`, `~/.gemini` or any account, token or credential file.
- An answer touches only the person's folder: the chat log, `tasks.json` and, with `saveTo`, the data store under `<base>/.harness/`.
- `display` and `saveTo.records` are harness code running in the main process. They get a `structuredClone` copy of the value and no file system, network or process handle. They must be pure and synchronous; one slower than 100 ms is logged (spec §11.3, like the data `rules`).

**D0 is a hard rule (like plan 1's D2).** A harness with no block that declares `input` must keep, byte for byte:
- `tasks.json` (no `pendingInput`);
- the prompts and the turn options (no `turn` option);
- the chat log (no block `id`, no `input`);
- the `AGENTS.md` managed section (no answers section, no `show_annotate`);
- the MCP tool list (no `annotate`) and every tool's answer text;
- `AppState` (no `inputs`).

Tasks 4, 5, 6, 7, 16 and 23 hold the regression tests. Every other task keeps D0 by adding fields only when they apply (conditional spreads).

## Decisions this plan takes where the spec leaves room

**Block ids and the pending input**
- **`blockId` format:** `<task id>:<turn>:<index>` (`blockIdOf`, regex `BLOCK_ID` in `packages/harness-sdk/src/answer.ts`).
  - `turn` is the task's finished-turn count when the turn starts (0 for the first).
  - `index` counts every block event of that turn, state blocks included.
  - Ids are given by `TurnController`, only in a task's `run` turns (never in a closing or checkpoint turn, which are quiet), and only to blocks that declare `input`. The id rides on the runtime `block` event (`Event.block.id?`), so the window, the chat log and the task manager all see the same one.
- **Where `pendingInput` lives:** `tasks.json` → `current.pendingInput = { blockId, block, shownAt }`, where `block` is the block's name. It belongs to the task, not to a scope.
  - Closing the task (`current: null`) drops it.
  - Switching scope closes the task first (scopes plan), so it drops it too.
  - It is recorded **while the turn runs**, as the block event arrives, so the window's task view knows it before the turn's `done` (no flash of a closed form).
- **D5 replacement:** a newer input block, in the same turn or a later one, overwrites `pendingInput`. The window shows any other unanswered input block as closed.
- **The window learns the pending block** from `CurrentTaskView.pendingInput` (the id).
- **A typed follow-up keeps the pending input** (spec §6). A choice that starts another action or the next path step closes the task, which drops it; a follow-up choice keeps it.

**`respond`**
- **Where `respond` acts:** on the open task, whatever scope is open. A `saveTo` write runs as the person, in the **task's** scope (`scopeOfTask`), the scope the agent's own data requests use. App-wide collections ignore it.
- **Order inside `respond`** (one `op()`):
  1. stale check (the task waits and this is its pending block);
  2. validation;
  3. the checkpoint, when `needsCheckpoint` (spec §6: it runs before the value is submitted, never during);
  4. `saveTo`;
  5. clear `pendingInput`;
  6. mark the chat entry;
  7. accept;
  8. `askNow(message, display)`.

  `askNow` then sees `checkpointed: true` and runs no second checkpoint.
- **Two-step answer.** `respond` returns `{ accepted, done }`.
  - `accepted` resolves with a `RespondResult`. The IPC handler returns it, so the window knows whether to show field errors or the person's line.
  - `done` resolves when the turn ends.
  - A failure after acceptance is logged and sent to the window as the turn's `done` (`agent-crashed`). A cancel or quit before acceptance rejects both, like `choose`.
- **How errors travel over IPC:** as data, never as thrown errors.
  - The result is `{ ok: false, reason, errors: InputIssue[] }`, where `reason` is `stale`, `invalid`, `refused` (`saveTo`) or `stopped` (a checkpoint was cancelled). The window adds `busy` and `failed` for its own refusals.
  - `InputIssue.path` is the zod path joined with dots; `""` is a form-level error.
  - Thrown errors (closing, a turn already running, turns blocked) stay thrown: Electron turns them into a rejected `invoke`, and the window shows a generic "didn't go through".
- **Size cap:** an answer whose JSON is over 50 000 characters is refused (`ANSWER_MAX_CHARS`). The block's own zod bounds come first.

**Values and the turn message**
- **Skippable value shape:** exactly `{ skipped: true }` (`SKIPPED`, `isSkipped`).
  - Only a block with `skippable: true` accepts it; validation and `saveTo` are skipped.
  - The readable line is "(saltado)" / "(skipped)".
  - The JSON carries `"value": {"skipped": true}`.
- **How the readable line is built (`readableAnswer`):**
  - one paragraph per answered field, `<label>: <value>`, joined by a blank line;
  - the label is `inputUi.label` in the task's language, else the field name humanized (`why` → "Why");
  - booleans read "sí"/"no" or "yes"/"no", multi-choice joins with ", ", and pairs read `front → back` joined by "; ";
  - empty optional fields are left out; an answer with nothing in it reads "(respuesta vacía)" / "(empty answer)", so the chat never shows the JSON.
- **`display(value, language)`** wins when it returns a non-empty string. A throw, a non-string or an empty string falls back to the core line, with a log.
- **The message:** `[respuesta a <block>]` (es) or `[answer to <block>]` (en), the readable line, a blank line, then the fenced `json` block with `{"block","blockId","value"}` on one line. `readAnswer` parses the last such fence.
- **Validation messages** are zod's own (English). The window shows them next to the fields as they come. Translating them is a known gap (docs, Task 22).

**Field kinds (§5)**
- **`choice` on a string field.** A string field becomes a `choice` when:
  - `inputUi.<field>.optionsFrom` names a string-array field of the shown data; or
  - by convention, the field is named `choice` and the shown schema has `options: z.array(z.string())`. This covers the spec's own example.

  When the shown data has no options at run time, the form falls back to a text field.
- **`pairs`:** an array of objects with exactly two string fields, of any names.
  - The column labels come from `inputUi.<field>.columns`, else the inner field names humanized.
  - Rows with both cells empty are dropped before sending.
- **`inputUi.kind`** may only switch a string field between `text`, `longText` and `choice`. Other kinds always come from the zod type.
- **A field the core form can't draw** (a nested object, a union…) gets `kind: null`. The core form says so and can't be sent; `check` warns (`input-form`) unless `ui/` registers a component for the block.

**`saveTo`**
- **Shape:** `saveTo: { collection, records?(value) }`, where `collection` must be a declared data collection.
  - Without `records`, the value itself is the one record.
  - With it, the function maps the value to records (the spec's flashcards: a summary + pairs into one record per card). It is pure harness code, like `display`.
- **All or nothing:** the records are written with a new `DataStore.putMany`. Every record is checked (permission, schema, key, rules) before the file is saved once, so a refusal writes none. The rules' `ctx.records` snapshot is the file before the batch.
- **History:** no commit of its own. The write lands in the next turn's "Before message" commit, which carries the task's trailer, so the task's undo covers it (spec §8).

**`annotate`**
- It is a core block (`INPUT_CORE_BLOCKS`). A harness gets it only when it declares an input block: `annotate` only works on answered input blocks (§11.4), and D0 keeps other harnesses' tool lists unchanged. The name `annotate` and the tool `show_annotate` are reserved for every harness.
- **`ref`:** an answered block's id, or `"last"` = the latest answered input block **before** the annotate's own entry in the chat, so an older annotate never re-points to a newer answer.
- **`field`:** that field of the value, else the answer's **longest** text field. The spec says "the first string field"; in its own example (`choice` + `why`) that is the short choice, while the marks are on the explanation.
- **`comment` is optional** (spec §7 lists it as required). A mark without one still shows its kind; the agent is not forced to write filler.
- **Anchoring:** each mark takes the first match of its `quote` that doesn't overlap a mark placed before it. A mark whose quote isn't found, or whose answer isn't in this chat, is listed as a plain comment, never dropped.

**Chat log and window**
- **Chat log:** the block entry gets `id` when shown and `input: { blockId, value, answeredAt }` once answered. `ChatLog.markAnswered` rewrites the file atomically (temp + rename). It runs inside the `respond` op, after the previous turn's writes were awaited and before the next turn appends.
- **Drafts:** kept in memory per block id (a module-level map in `InputForm.tsx`). They survive the chat view unmounting (Home, Settings), not a restart (§11.2), and are dropped on a successful send.
- **What the window shows of an input block:**
  - **pending + the task waits + nothing runs:** the form, enabled;
  - **pending while something runs:** the form, disabled;
  - **answered:** the answer, read-only;
  - **anything else:** "This question is closed."
  - The core view's heading is the first string field of the shown data. A harness that wants more registers its own component, which gets `input` and can reuse the exported `InputForm`.

**Mock mode, terminal and check (§8)**
- **Mock recordings:** a turn may carry `respond: [{ block, value, next }]`, each a recorded answer to that turn's input block and the turn it leads to. This extends the spec's `respond: { block, value }` with the branch, as the spec asks ("a branch per answer, like the per-choice `next`").
  - Replay reads the prompt with `readAnswer`. An answer equal (key order ignored) to a recorded one plays its `next`; any other answer follows `next["*"]`, then the fallback.
  - `run --record` appends the answer the developer gave.
- **Terminal:**
  - `run` draws an input block's shown data, then its fields as a numbered list.
  - At the prompt, `a` answers the pending block: one prompt per field. A choice is picked by number; `pairs` repeat until an empty line; a skippable block first asks "Skip?".
  - A refused answer prints its errors and goes back to the prompt.
- **`check`:**
  - `input-hidden` warns on `visible: false` with `input`.
  - `input-form` warns when a field has `kind: null` and no file in `ui/` mentions the block's name as an object key (a heuristic: `name:`, `name,` or `name }`).
  - `mock-input` (an error) checks that each recorded answer names an input block shown in that turn and passes `parseAnswer`. A `respond[].next` that is no turn is `mock-next`.

## What in the code conflicts with the spec (and how this plan handles it)

| Conflict | Where | Handling |
|---|---|---|
| Electron's `ipcMain.handle` turns a thrown error into a string, losing zod issues | `shell/src/main/index.ts` `handle()` | `respond` answers with a `RespondResult` value (Tasks 8, 9) |
| The window starts its live turn only when it dispatches the person's message, but only main knows the readable line (`display` runs there) | `ui/src/state.ts`, `ChatView.tsx` | `accepted` resolves before the turn starts; the window then dispatches `user` with `display` (Tasks 8, 12) |
| Block events carry no id, and the TaskManager's scripted test turns bypass `TurnController` | `runtime/src/events.ts`, `shell/test/task-manager*.test.ts` | Optional `id` on the event, stamped in `TurnController` (Task 6); TaskManager tests feed events with ids (Task 7) |
| The chat log is append-only JSONL, but §8 puts the answer on the block's entry | `shell/src/main/chat-log.ts` | `ChatLog.markAnswered` rewrites the file atomically (Task 6) |
| The renderer has no zod schemas (it gets plain `AppState`) | `ui` | `inputSpec` turns the zod object into plain `InputField`s in main (Tasks 2, 9) |
| `annotate` as a core block would change every harness's tools and `AGENTS.md` | `harness-sdk/src/core-blocks.ts`, `allBlocks` | Offered only with input blocks (Task 16) |
| `check` can't see which components `ui/App.tsx` registers | `cli/src/check.ts` | A text heuristic over `ui/` sources (Task 13) |
| The e2e app is built for one harness (`HH_HARNESS_DIR`), and the fixture's screen must typecheck | `shell/electron.vite.config.ts`, root `tsconfig.json` | The e2e builds the fixture into `packages/shell/out/input`; fake-agent gets `@humanharness/ui`, `react`, `@types/react` as dev dependencies (Task 23) |
| The spec's `saveTo` example (summary + flashcards into a flashcards collection) needs a mapping | spec §9 | `saveTo.records(value)` (Task 14) |
| The spec has no yellow token for `gap` | `ui/src/styles.css` | New `--hh-highlight` token, light and dark (Task 17) |

## File Structure

```
packages/harness-sdk/src/block.ts          Block: input, inputUi, submitLabel, skippable, display, saveTo; InputBlock,
                                           inputBlocks, InputFieldUi, InputKind, SkippedAnswer                         (Tasks 1, 14)
packages/harness-sdk/src/input.ts          NEW. inputFields, inputSpec, inputSpecs, choiceOptions, InputField, InputSpec (Task 2)
packages/harness-sdk/src/answer.ts         NEW. BLOCK_ID, blockIdOf, parseAnswer, readableAnswer, answerDisplay,
                                           answerMessage, readAnswer, answerRecords, RespondResult, BlockAnswer        (Tasks 3, 14)
packages/harness-sdk/src/core-blocks.ts    annotate (INPUT_CORE_BLOCKS), hasInputBlocks, allBlocks                     (Task 16)
packages/harness-sdk/src/index.ts          exports; blockSchema accepts input; saveTo collection check; reserved tools  (Tasks 1, 2, 3, 14, 16)
packages/runtime/src/events.ts             block event `id?`                                                            (Task 4)
packages/blocks/src/ui-server.ts           INPUT_DONE answer for input blocks                                           (Task 4)
packages/workspace/src/instructions.ts     answers section, Answer schema line, annotate line                           (Tasks 5, 16)
packages/workspace/src/data.ts             DataStore.putMany                                                            (Task 14)
packages/shell/src/main/turn-controller.ts inputBlocks dep, `turn` option, stamps ids                                   (Task 6)
packages/shell/src/main/chat-log.ts        TurnRecorder keeps ids; ChatLog.markAnswered                                 (Task 6)
packages/shell/src/main/task-store.ts      PendingInput, CurrentTask.pendingInput                                       (Task 7)
packages/shell/src/main/task-manager.ts    inputs, pending recording, respond, markAnswered, saveAnswer                 (Tasks 7, 8, 15)
packages/shell/src/main/index.ts           AppState.inputs, hh:respond, deps wiring                                     (Tasks 9, 15)
packages/shell/src/preload/index.ts        client.respond                                                               (Task 9)
packages/ui/src/client.ts                  ChatBlock, CurrentTaskView.pendingInput, AppState.inputs, respond, types     (Tasks 6, 7, 9)
packages/ui/src/state.ts                   block ids in live turns, `answered` action                                   (Task 10)
packages/ui/src/InputForm.tsx              NEW. InputForm, AnswerView, drafts                                           (Task 11)
packages/ui/src/InputBlock.tsx             NEW. InputHost, CoreInputBlock                                               (Task 12)
packages/ui/src/Message.tsx                InputProps, BlockProps.input/answerOf, Blocks → InputHost                    (Tasks 12, 17)
packages/ui/src/ChatView.tsx               respondTo, inputFor, answerOf, annotate registration                         (Tasks 12, 17)
packages/ui/src/annotate.ts                NEW. anchorMarks, readAnnotation, answerText                                 (Task 17)
packages/ui/src/AnnotateBlock.tsx          NEW. The core annotate view                                                  (Task 17)
packages/ui/src/index.ts                   exports InputForm, InputProps                                                (Task 12)
packages/ui/src/styles.css                 form, answer, marks, --hh-highlight                                          (Tasks 11, 17)
packages/ui/test/fake-client.ts            respond                                                                      (Task 9)
packages/i18n/src/locales/{es,en}.json     input.*, annotate.*                                                          (Tasks 11, 12, 17)
packages/fake-agent/src/mock.ts            turn `respond`                                                               (Task 18)
packages/fake-agent/src/mock-replay.ts     replay follows answers                                                       (Task 18)
packages/fake-agent/fixtures/input-harness/ NEW. The `quiz` fixture (blocks; data in 14; ui in 23)                      (Tasks 4, 14, 23)
packages/fake-agent/package.json           dev deps for the fixture's screen                                            (Task 23)
packages/cli/src/check.ts                  input-hidden, input-form, mock-input                                         (Tasks 13, 19)
packages/cli/src/terminal.ts               input blocks and annotate in the terminal                                    (Task 20)
packages/cli/src/input-prompt.ts           NEW. promptAnswer                                                            (Task 20)
packages/cli/src/record.ts                 Recorder.answer                                                              (Task 21)
packages/cli/src/run.ts                    `a` answers; inputs, markAnswered, saveAnswer wiring                         (Task 21)
packages/cli/guide/new-harness.md          Phase 2 asks about answers                                                   (Task 22)
docs/architecture/{blocks,mock-mode,authoring,history}.md                                                               (Task 22)
packages/e2e/tests/input.spec.ts           NEW. The round trip on the fixture                                           (Task 23)
packages/e2e/tests/input-scripts.ts        NEW. Its fake-claude script                                                  (Task 23)
packages/e2e/tests/flow.spec.ts            D0 on the demo                                                               (Task 23)
```

---

## Phase 1 — Contract (spec §10 slice 1)

### Task 1: `Block` declares what the person answers

**Files:**
- Modify: `packages/harness-sdk/src/block.ts`, `packages/harness-sdk/src/index.ts`
- Test: `packages/harness-sdk/test/input.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/harness-sdk/test/input.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defineBlock, defineHarness, inputBlocks, z } from "../src";

const commit = () =>
  defineBlock({
    description: "Asks for an answer and why.",
    visible: true,
    schema: z.object({ question: z.string(), options: z.array(z.string()).max(4).optional() }),
    input: z.object({ choice: z.string().optional(), why: z.string().min(1).max(1000) }),
    inputUi: { why: { kind: "longText", label: { es: "¿Por qué? Con tus palabras", en: "Why? In your own words" } } },
    submitLabel: { es: "Me comprometo", en: "I commit" },
    skippable: true,
    display: (value, language) => (language === "es" ? `Elegí: ${"choice" in value ? String(value.choice) : ""}` : "Picked"),
    example: { question: "¿Quién comió más?", options: ["Yo", "Las dos igual"] },
  });

describe("defineBlock with input", () => {
  it("keeps input, inputUi, submitLabel, skippable and display", () => {
    const b = commit();
    expect(b.input).toBeInstanceOf(z.ZodObject);
    expect(b.inputUi?.why?.kind).toBe("longText");
    expect(b.submitLabel).toEqual({ es: "Me comprometo", en: "I commit" });
    expect(b.skippable).toBe(true);
    expect(b.display?.({ why: "x", choice: "Yo" }, "es")).toBe("Elegí: Yo");
  });

  it("refuses an input that is not a z.object", () => {
    expect(() =>
      defineBlock({ description: "x", visible: true, schema: z.object({}), input: z.string() as unknown as z.ZodObject, example: {} }),
    ).toThrow(/input must be a z.object/);
  });

  it("refuses inputUi for a field the input doesn't have", () => {
    expect(() =>
      defineBlock({
        description: "x",
        visible: true,
        schema: z.object({}),
        input: z.object({ why: z.string() }),
        inputUi: { nope: { label: { es: "a", en: "a" } } } as never,
        example: {},
      }),
    ).toThrow(/inputUi.nope/);
  });

  it("refuses answer settings on a block with no input", () => {
    expect(() => defineBlock({ description: "x", visible: true, schema: z.object({}), skippable: true, example: {} })).toThrow(/need an input/);
  });

  it("a harness keeps its input blocks, and inputBlocks finds them", () => {
    const card = defineBlock({ description: "c", visible: true, schema: z.object({ t: z.string() }), example: { t: "a" } });
    const h = defineHarness({
      id: "quiz",
      name: { es: "Q", en: "Q" },
      core: "^0.1.0",
      languages: ["es", "en"],
      engines: ["claude"],
      folder: { suggested: "Documents/Q" },
      instructions: "./AGENTS.md",
      permissions: { edit: "none", exec: false, web: false },
      blocks: { card, commit_answer: commit() },
      author: "t",
    });
    expect(Object.keys(inputBlocks(h.blocks))).toEqual(["commit_answer"]);
    expect(inputBlocks({ card })).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/harness-sdk/test/input.test.ts`
Expected: FAIL (`inputBlocks` is not exported; `input` is not a known key of `Block`, so typecheck would fail too).

- [ ] **Step 3: Implement**

Replace `packages/harness-sdk/src/block.ts` with:

```ts
import { z } from "zod";
import type { Language, LocalizedText } from "./index";

/** How the core form draws a field (input-blocks spec §5). */
export const INPUT_KINDS = ["text", "longText", "number", "choice", "multiChoice", "pairs", "boolean"] as const;
export type InputKind = (typeof INPUT_KINDS)[number];

/** How the core form draws one field of `input`. Everything is optional: without it, the form guesses from the zod type. */
export interface InputFieldUi {
  /** String fields only: one line, a growing textarea, or a choice among `optionsFrom`. */
  kind?: "text" | "longText" | "choice";
  label?: LocalizedText;
  /** A string field drawn as a choice: the field of the shown data (`schema`) that holds the options, a string array. */
  optionsFrom?: string;
  /** `pairs` fields: each column's label, by the inner field's name. */
  columns?: Record<string, LocalizedText>;
}

/** What a `skippable` block gets when the person skips it (spec §6 "Cancel"). */
export type SkippedAnswer = { skipped: true };

/** A piece of UI the agent can show (visible) or update (state-only) through an MCP tool. */
export interface Block<S extends z.ZodObject = z.ZodObject, I extends z.ZodObject = z.ZodObject> {
  description: string;
  visible: boolean;
  schema: S;
  example: z.infer<S>;
  /** The MCP tool's name. Default: `show_<name>` for visible blocks, `update_<name>` for state-only ones. */
  tool?: string;
  /** What the person answers (input-blocks spec D1): a zod object, checked in the main process. Absent: the block only shows. */
  input?: I;
  /** How the core form draws each field of `input`. */
  inputUi?: Partial<Record<keyof z.infer<I> & string, InputFieldUi>>;
  /** The send button's text. Default: "Enviar" / "Send". */
  submitLabel?: LocalizedText;
  /** The person may skip the question: the answer is then `{ skipped: true }`. */
  skippable?: boolean;
  /**
   * The chat's line for an answer, instead of the core's. Harness code run in the main process: pure, synchronous
   * and fast. It gets a copy of the value; anything but a non-empty string falls back to the core's line.
   */
  display?(value: z.infer<I> | SkippedAnswer, language: Language): string;
}

/** A block the person answers. */
export type InputBlock = Block & { input: z.ZodObject };

export const isInputBlock = (b: Block): b is InputBlock => b.input !== undefined;

/** The blocks of `blocks` that declare an input, by name ({} when none: spec D0). */
export function inputBlocks(blocks: Record<string, Block>): Record<string, InputBlock> {
  return Object.fromEntries(Object.entries(blocks).filter((e): e is [string, InputBlock] => isInputBlock(e[1])));
}

export function defineBlock<S extends z.ZodObject, I extends z.ZodObject = z.ZodObject>(block: Block<S, I>): Block<S, I> {
  const result = block.schema.safeParse(block.example);
  if (!result.success) throw new Error(`The block example does not match its schema: ${result.error.message}`);
  if (block.input === undefined) {
    if (block.inputUi !== undefined || block.submitLabel !== undefined || block.skippable !== undefined || block.display !== undefined) {
      throw new Error("inputUi, submitLabel, skippable and display need an input");
    }
    return block;
  }
  if (!(block.input instanceof z.ZodObject)) throw new Error("A block's input must be a z.object(...) schema");
  for (const field of Object.keys(block.inputUi ?? {})) {
    if (!Object.hasOwn(block.input.shape, field)) throw new Error(`inputUi.${field}: "${field}" is not a field of the block's input`);
  }
  return block;
}

/** Name of the MCP tool the agent calls for a block. */
export function blockToolName(name: string, block: Pick<Block, "visible" | "tool">): string {
  return block.tool ?? `${block.visible ? "show" : "update"}_${name}`;
}
```

In `packages/harness-sdk/src/index.ts`, in `blockSchema`'s check, replace

```ts
      x.schema instanceof z.ZodObject &&
      x.schema.safeParse(x.example).success
```

with

```ts
      x.schema instanceof z.ZodObject &&
      x.schema.safeParse(x.example).success &&
      (x.input === undefined || x.input instanceof z.ZodObject)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/harness-sdk/test`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green. (`block.ts` imports `Language` and `LocalizedText` as types only: the import cycle with `index.ts` is erased.)

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/harness-sdk/src/block.ts packages/harness-sdk/src/index.ts packages/harness-sdk/test/input.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(sdk): a block may declare what the person answers" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 2: Field kinds from the zod schema

**Files:**
- Create: `packages/harness-sdk/src/input.ts`
- Modify: `packages/harness-sdk/src/index.ts`
- Test: `packages/harness-sdk/test/input.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/harness-sdk/test/input.test.ts`, add `choiceOptions, inputFields, inputSpec, inputSpecs` to the import from `../src`, and append:

```ts
describe("inputFields", () => {
  const block = (input: z.ZodObject, schema: z.ZodObject = z.object({}), inputUi?: object) =>
    defineBlock({ description: "x", visible: true, schema, input, ...(inputUi ? { inputUi: inputUi as never } : {}), example: {} as never });

  it("reads the spec's example: a choice from the shown options, and a long text with its label", () => {
    expect(inputFields(commit())).toEqual([
      { name: "choice", kind: "choice", label: { es: "Choice", en: "Choice" }, optional: true, optionsFrom: "options" },
      { name: "why", kind: "longText", label: { es: "¿Por qué? Con tus palabras", en: "Why? In your own words" }, optional: false, min: 1, max: 1000 },
    ]);
  });

  it("guesses each kind from the zod type", () => {
    const b = block(
      z.object({
        title: z.string().max(80),
        notes: z.string(),
        count: z.number().int().min(1).max(5),
        level: z.enum(["low", "high"]),
        tags: z.array(z.enum(["a", "b"])),
        cards: z.array(z.object({ front: z.string(), back: z.string() })),
        sure: z.boolean().default(false),
        deep: z.object({ x: z.string() }),
      }),
    );
    expect(inputFields(b).map((f) => [f.name, f.kind, f.optional])).toEqual([
      ["title", "text", false],
      ["notes", "longText", false],
      ["count", "number", false],
      ["level", "choice", false],
      ["tags", "multiChoice", false],
      ["cards", "pairs", false],
      ["sure", "boolean", true],
      ["deep", null, false],
    ]);
    const [title, , count, level, tags, cards] = inputFields(b);
    expect(title).toMatchObject({ max: 80 });
    expect(count).toMatchObject({ min: 1, max: 5 });
    expect(level.options).toEqual(["low", "high"]);
    expect(tags.options).toEqual(["a", "b"]);
    expect(cards.columns).toEqual([
      { name: "front", label: { es: "Front", en: "Front" } },
      { name: "back", label: { es: "Back", en: "Back" } },
    ]);
  });

  it("takes inputUi: a kind for strings, labels, options from the shown data, column labels", () => {
    const b = block(
      z.object({ short: z.string(), pick: z.string(), cards: z.array(z.object({ q: z.string(), a: z.string() })) }),
      z.object({ answers: z.array(z.string()).optional() }),
      {
        short: { kind: "text" },
        pick: { optionsFrom: "answers", label: { es: "Elegí", en: "Pick" } },
        cards: { columns: { q: { es: "Pregunta", en: "Question" }, a: { es: "Respuesta", en: "Answer" } } },
      },
    );
    const [short, pick, cards] = inputFields(b);
    expect(short.kind).toBe("text");
    expect(pick).toMatchObject({ kind: "choice", optionsFrom: "answers", label: { es: "Elegí", en: "Pick" } });
    expect(cards.columns?.map((c) => c.label.en)).toEqual(["Question", "Answer"]);
  });

  it("a field named choice with no shown options is plain text", () => {
    expect(inputFields(block(z.object({ choice: z.string().max(40) })))[0]).toMatchObject({ kind: "text" });
  });

  it("inputSpec is plain data for the window; inputSpecs covers only input blocks", () => {
    const spec = inputSpec(commit());
    expect(spec.submitLabel).toEqual({ es: "Me comprometo", en: "I commit" });
    expect(spec.skippable).toBe(true);
    expect(JSON.parse(JSON.stringify(spec))).toEqual(spec);
    const card = defineBlock({ description: "c", visible: true, schema: z.object({}), example: {} });
    expect(Object.keys(inputSpecs({ card, commit_answer: commit() }))).toEqual(["commit_answer"]);
  });

  it("choiceOptions: an enum's options, or the shown data's strings", () => {
    const [choice] = inputFields(commit());
    expect(choiceOptions(choice, { question: "q", options: ["Yo", 3, "Mi amiga"] })).toEqual(["Yo", "Mi amiga"]);
    expect(choiceOptions(choice, { question: "q" })).toEqual([]);
    expect(choiceOptions({ name: "l", kind: "choice", label: { es: "l", en: "l" }, optional: false, options: ["a"] }, null)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/harness-sdk/test/input.test.ts`
Expected: FAIL (`inputFields` is not exported).

- [ ] **Step 3: Write `input.ts`**

Create `packages/harness-sdk/src/input.ts`:

```ts
import { z } from "zod";
import type { Block, InputFieldUi, InputKind } from "./block";
import type { LocalizedText } from "./index";

/** Strings up to this many characters get one line; longer or unbounded ones a growing textarea (spec §5). */
export const SHORT_TEXT_MAX = 200;

/** One field of an input block, as plain data: what the window's form and the terminal draw. */
export interface InputField {
  name: string;
  /** null: the core form can't draw this field (a harness component must). */
  kind: InputKind | null;
  label: LocalizedText;
  optional: boolean;
  /** Text: length bounds. Number: value bounds. */
  min?: number;
  max?: number;
  /** An enum `choice` and `multiChoice`: the options. */
  options?: string[];
  /** A `choice` on a string field: the shown data's field that holds the options. */
  optionsFrom?: string;
  /** `pairs`: the two inner fields, in order, with their labels. */
  columns?: { name: string; label: LocalizedText }[];
}

/** What the window needs to draw an input block's core form; sent with the app state. */
export interface InputSpec {
  fields: InputField[];
  submitLabel?: LocalizedText;
  skippable?: boolean;
}

function humanize(name: string): string {
  const words = name.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : name;
}
const plainLabel = (name: string): LocalizedText => ({ es: humanize(name), en: humanize(name) });

/** The type under `.optional()` and `.default()`, and whether the field may be left out. */
function unwrap(type: z.ZodType): { inner: z.ZodType; optional: boolean } {
  let inner = type;
  let optional = false;
  while (inner instanceof z.ZodOptional || inner instanceof z.ZodDefault) {
    optional = true;
    inner = inner.unwrap() as z.ZodType;
  }
  return { inner, optional };
}

const isStringArray = (type: z.ZodType | undefined): boolean => {
  if (!type) return false;
  const { inner } = unwrap(type);
  return inner instanceof z.ZodArray && unwrap(inner.element as z.ZodType).inner instanceof z.ZodString;
};

const bound = (key: "min" | "max", v: number | null | undefined): Partial<Record<"min" | "max", number>> =>
  typeof v === "number" && Number.isFinite(v) ? { [key]: v } : {};

function fieldOf(name: string, type: z.ZodType, ui: InputFieldUi | undefined, shown: Record<string, z.ZodType>): InputField {
  const { inner, optional } = unwrap(type);
  const base = { name, label: ui?.label ?? plainLabel(name), optional };
  if (inner instanceof z.ZodString) {
    // By convention a `choice` field takes the shown data's `options` (the spec's own example).
    const from = ui?.optionsFrom ?? (name === "choice" && isStringArray(shown.options) ? "options" : undefined);
    if (from && (ui?.kind === undefined || ui.kind === "choice")) return { ...base, kind: "choice", optionsFrom: from };
    const long = ui?.kind === "longText" || (ui?.kind !== "text" && (inner.maxLength === null || inner.maxLength > SHORT_TEXT_MAX));
    return { ...base, kind: long ? "longText" : "text", ...bound("min", inner.minLength), ...bound("max", inner.maxLength) };
  }
  if (inner instanceof z.ZodEnum) return { ...base, kind: "choice", options: inner.options.map(String) };
  if (inner instanceof z.ZodNumber) return { ...base, kind: "number", ...bound("min", inner.minValue), ...bound("max", inner.maxValue) };
  if (inner instanceof z.ZodBoolean) return { ...base, kind: "boolean" };
  if (inner instanceof z.ZodArray) {
    const element = unwrap(inner.element as z.ZodType).inner;
    if (element instanceof z.ZodEnum) return { ...base, kind: "multiChoice", options: element.options.map(String) };
    if (element instanceof z.ZodObject) {
      const columns = Object.entries(element.shape as Record<string, z.ZodType>);
      if (columns.length === 2 && columns.every(([, t]) => t instanceof z.ZodString)) {
        return { ...base, kind: "pairs", columns: columns.map(([c]) => ({ name: c, label: ui?.columns?.[c] ?? plainLabel(c) })) };
      }
    }
  }
  return { ...base, kind: null };
}

/** The fields of a block's input, in order ([] for a block with no input). */
export function inputFields(block: Pick<Block, "input" | "inputUi" | "schema">): InputField[] {
  if (!block.input) return [];
  const shown = block.schema.shape as Record<string, z.ZodType>;
  const ui = (block.inputUi ?? {}) as Record<string, InputFieldUi | undefined>;
  return Object.entries(block.input.shape as Record<string, z.ZodType>).map(([name, type]) => fieldOf(name, type, ui[name], shown));
}

export function inputSpec(block: Block): InputSpec {
  return {
    fields: inputFields(block),
    ...(block.submitLabel ? { submitLabel: block.submitLabel } : {}),
    ...(block.skippable ? { skippable: true } : {}),
  };
}

/** The specs of the blocks that declare an input, by name ({} when none: spec D0). */
export function inputSpecs(blocks: Record<string, Block>): Record<string, InputSpec> {
  return Object.fromEntries(Object.entries(blocks).flatMap(([name, b]) => (b.input ? [[name, inputSpec(b)]] : [])));
}

/** A choice's options: an enum's own, or the strings in the shown data's `optionsFrom` field. */
export function choiceOptions(field: InputField, data: unknown): string[] {
  if (field.options) return field.options;
  if (!field.optionsFrom || typeof data !== "object" || data === null) return [];
  const raw = (data as Record<string, unknown>)[field.optionsFrom];
  return Array.isArray(raw) ? raw.filter((o): o is string => typeof o === "string" && o.length > 0) : [];
}
```

In `packages/harness-sdk/src/index.ts`, after `export * from "./data";`, add:

```ts
export * from "./input";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/harness-sdk/test/input.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/harness-sdk/src/input.ts packages/harness-sdk/src/index.ts packages/harness-sdk/test/input.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(sdk): input fields as plain data, their kind guessed from zod" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 3: Answers: ids, validation, the readable line and the turn message

**Files:**
- Create: `packages/harness-sdk/src/answer.ts`
- Modify: `packages/harness-sdk/src/index.ts`
- Test: `packages/harness-sdk/test/answer.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/harness-sdk/test/answer.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  ANSWER_MAX_CHARS,
  BLOCK_ID,
  answerDisplay,
  answerMessage,
  blockIdOf,
  defineBlock,
  isSkipped,
  parseAnswer,
  readAnswer,
  readableAnswer,
  z,
} from "../src";

const commit = defineBlock({
  description: "Commit.",
  visible: true,
  schema: z.object({ question: z.string(), options: z.array(z.string()).optional() }),
  input: z.object({ choice: z.string().optional(), why: z.string().min(1).max(1000) }),
  inputUi: { choice: { label: { es: "Elegí", en: "I pick" } }, why: { label: { es: "Por qué", en: "Why" } } },
  skippable: true,
  example: { question: "q" },
});
const all = defineBlock({
  description: "All kinds.",
  visible: true,
  schema: z.object({}),
  input: z.object({
    sure: z.boolean(),
    tags: z.array(z.enum(["a", "b"])),
    cards: z.array(z.object({ front: z.string(), back: z.string() })),
    count: z.number().optional(),
  }),
  example: {},
});

describe("block ids", () => {
  it("are task, turn and index", () => {
    expect(blockIdOf("3f6c-aa", 2, 1)).toBe("3f6c-aa:2:1");
    expect(BLOCK_ID.test("3f6c-aa:2:1")).toBe(true);
    expect(BLOCK_ID.test("t1:x:1")).toBe(false);
    expect(BLOCK_ID.test("../t:1:1")).toBe(false);
  });
});

describe("parseAnswer", () => {
  it("returns the parsed value, or the issues by field", () => {
    expect(parseAnswer(commit, { choice: "Yo", why: "porque", extra: 1 })).toEqual({ ok: true, value: { choice: "Yo", why: "porque" } });
    const bad = parseAnswer(commit, { why: "" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.map((e) => e.path)).toEqual(["why"]);
  });

  it("takes { skipped: true } only from a skippable block", () => {
    expect(isSkipped({ skipped: true })).toBe(true);
    expect(isSkipped({ skipped: true, why: "x" })).toBe(false);
    expect(parseAnswer(commit, { skipped: true })).toEqual({ ok: true, value: { skipped: true } });
    expect(parseAnswer(all, { skipped: true }).ok).toBe(false);
  });

  it("refuses an answer too long to send", () => {
    const big = defineBlock({ description: "b", visible: true, schema: z.object({}), input: z.object({ text: z.string() }), example: {} });
    const r = parseAnswer(big, { text: "x".repeat(ANSWER_MAX_CHARS) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatchObject({ path: "" });
  });
});

describe("readableAnswer", () => {
  it("is one `label: value` paragraph per answered field, in the task's language", () => {
    expect(readableAnswer(commit, { choice: "Las dos igual", why: "Porque 2 pedazos chiquitos son como uno grande" }, "es")).toBe(
      "Elegí: Las dos igual\n\nPor qué: Porque 2 pedazos chiquitos son como uno grande",
    );
    expect(readableAnswer(commit, { why: "because" }, "en")).toBe("Why: because");
  });

  it("reads booleans, multi-choices and pairs; a skipped or empty answer has its own words", () => {
    expect(readableAnswer(all, { sure: true, tags: ["a", "b"], cards: [{ front: "2+2", back: "4" }, { front: "3·3", back: "9" }] }, "es")).toBe(
      "Sure: sí\n\nTags: a, b\n\nCards: 2+2 → 4; 3·3 → 9",
    );
    expect(readableAnswer(commit, { skipped: true }, "es")).toBe("(saltado)");
    expect(readableAnswer(commit, { skipped: true }, "en")).toBe("(skipped)");
    expect(readableAnswer(all, { sure: false, tags: [], cards: [] }, "en")).toBe("Sure: no");
    const empty = defineBlock({ description: "e", visible: true, schema: z.object({}), input: z.object({ note: z.string().optional() }), example: {} });
    expect(readableAnswer(empty, {}, "en")).toBe("(empty answer)");
  });
});

describe("answerDisplay", () => {
  it("uses the harness's display, on a copy, and falls back to the core line", () => {
    const seen: unknown[] = [];
    const own = defineBlock({
      ...commit,
      display: (value) => {
        seen.push(value);
        (value as { why: string }).why = "changed";
        return "  Me comprometo con: Yo  ";
      },
    });
    const value = { choice: "Yo", why: "x" };
    expect(answerDisplay("commit_answer", own, value, "es")).toBe("Me comprometo con: Yo");
    expect(value.why).toBe("x");
    const log = vi.fn();
    const throws = defineBlock({ ...commit, display: () => { throw new Error("boom"); } });
    expect(answerDisplay("commit_answer", throws, value, "es", log)).toBe("Elegí: Yo\n\nPor qué: x");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("boom"));
    const blank = defineBlock({ ...commit, display: () => " " });
    expect(answerDisplay("commit_answer", blank, value, "es", log)).toBe("Elegí: Yo\n\nPor qué: x");
  });

  it("logs a slow display", () => {
    let now = 0;
    const slow = defineBlock({ ...commit, display: () => "ok" });
    const log = vi.fn();
    expect(answerDisplay("commit_answer", slow, { why: "x" }, "en", log, () => (now += 150))).toBe("ok");
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/display of "commit_answer" took 150 ms/));
  });
});

describe("the turn message", () => {
  it("holds the readable line and the exact JSON, and reads back", () => {
    const value = { choice: "Las dos igual", why: "Porque sí" };
    const message = answerMessage({ name: "commit_answer", blockId: "t1:0:0", value, display: "Elegí: Las dos igual", language: "es" });
    expect(message).toBe(
      '[respuesta a commit_answer]\nElegí: Las dos igual\n\n```json\n{"block":"commit_answer","blockId":"t1:0:0","value":{"choice":"Las dos igual","why":"Porque sí"}}\n```',
    );
    expect(answerMessage({ name: "x", blockId: "t1:0:0", value: {}, display: "d", language: "en" }).startsWith("[answer to x]\nd")).toBe(true);
    expect(readAnswer(message)).toEqual({ block: "commit_answer", blockId: "t1:0:0", value });
  });

  it("reads nothing from a plain message or a broken fence", () => {
    expect(readAnswer("Contame más.")).toBeNull();
    expect(readAnswer("x\n\n```json\n{not json}\n```")).toBeNull();
    expect(readAnswer('x\n\n```json\n{"block":"a"}\n```')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/harness-sdk/test/answer.test.ts`
Expected: FAIL (nothing is exported yet).

- [ ] **Step 3: Write `answer.ts`**

Create `packages/harness-sdk/src/answer.ts`:

```ts
import type { z } from "zod";
import type { Block, SkippedAnswer } from "./block";
import type { Language } from "./index";
import { type InputField, inputFields } from "./input";

/** `<task id>:<turn>:<index of the block in the turn>` (input-blocks spec §4). */
export const BLOCK_ID = /^[A-Za-z0-9-]{1,100}:\d{1,6}:\d{1,4}$/;
export const blockIdOf = (task: string, turn: number, index: number): string => `${task}:${turn}:${index}`;

/** An answer whose JSON is longer than this is refused (the block's own bounds come first). */
export const ANSWER_MAX_CHARS = 50_000;
/** Harness code on an answer (`display`, `saveTo.records`) slower than this is logged: it can't be stopped (spec §11.3). */
export const ANSWER_CODE_SLOW_MS = 100;

/** A problem with an answer: `path` is the field (zod path joined with dots), "" for the whole answer. */
export interface InputIssue {
  path: string;
  message: string;
}

/** An answer as the chat log keeps it on its block (spec §8). */
export interface BlockAnswer {
  blockId: string;
  value: Record<string, unknown>;
  answeredAt: string;
}

/**
 * What `client.respond` resolves with: taken (with the chat's line), or refused with nothing run. `busy` and
 * `failed` are the window's own refusals (a turn runs; the call itself failed).
 */
export type RespondResult =
  | { ok: true; display: string; value: Record<string, unknown>; answeredAt: string }
  | { ok: false; reason: "stale" | "invalid" | "refused" | "stopped" | "busy" | "failed"; errors: InputIssue[] };

export const SKIPPED: SkippedAnswer = { skipped: true };

export function isSkipped(value: unknown): value is SkippedAnswer {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 1 && (value as { skipped?: unknown }).skipped === true;
}

export const inputIssues = (error: z.ZodError): InputIssue[] => error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));

/** Checks an answer against the block's input (spec D3). A skip counts only for a `skippable` block. */
export function parseAnswer(
  block: Pick<Block, "input" | "skippable">,
  raw: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; errors: InputIssue[] } {
  if (!block.input) return { ok: false, errors: [{ path: "", message: "This block takes no answer" }] };
  if (isSkipped(raw)) return block.skippable ? { ok: true, value: { ...SKIPPED } } : { ok: false, errors: [{ path: "", message: "This question can't be skipped" }] };
  const parsed = block.input.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: inputIssues(parsed.error) };
  const value = parsed.data as Record<string, unknown>;
  if (JSON.stringify(value).length > ANSWER_MAX_CHARS) return { ok: false, errors: [{ path: "", message: `The answer is too long: keep it under ${ANSWER_MAX_CHARS} characters` }] };
  return { ok: true, value };
}

const WORDS: Record<Language, { yes: string; no: string; skipped: string; empty: string; answer: string }> = {
  es: { yes: "sí", no: "no", skipped: "(saltado)", empty: "(respuesta vacía)", answer: "respuesta a" },
  en: { yes: "yes", no: "no", skipped: "(skipped)", empty: "(empty answer)", answer: "answer to" },
};

function textOf(field: InputField, v: unknown, language: Language): string {
  if (v === undefined || v === null) return "";
  if (field.kind === "boolean") return v === true ? WORDS[language].yes : WORDS[language].no;
  if (field.kind === "multiChoice" && Array.isArray(v)) return v.map(String).join(", ");
  if (field.kind === "pairs" && Array.isArray(v) && field.columns) {
    return v.map((row) => field.columns!.map((c) => String((row as Record<string, unknown> | null)?.[c.name] ?? "")).join(" → ")).join("; ");
  }
  return typeof v === "string" || typeof v === "number" ? String(v) : JSON.stringify(v);
}

/** The core's readable line (spec §4): one `<label>: <value>` paragraph per answered field. */
export function readableAnswer(block: Pick<Block, "input" | "inputUi" | "schema">, value: Record<string, unknown>, language: Language): string {
  if (isSkipped(value)) return WORDS[language].skipped;
  const parts = inputFields(block).flatMap((f) => {
    const text = textOf(f, value[f.name], language).trim();
    return text ? [`${f.label[language]}: ${text}`] : [];
  });
  return parts.join("\n\n") || WORDS[language].empty;
}

/** Runs harness code on a copy of an answer, logging it when slow. (`performance` is global in Node and browsers.) */
export function timed<T>(what: string, run: () => T, log: (message: string) => void, now: () => number = () => performance.now()): T {
  const started = now();
  try {
    return run();
  } finally {
    const ms = now() - started;
    if (ms > ANSWER_CODE_SLOW_MS) log(`The ${what} took ${Math.round(ms)} ms: keep it small and pure`);
  }
}

/** The chat's line for an answer: the block's `display` when it gives a non-empty string, else the core's line. */
export function answerDisplay(
  name: string,
  block: Block,
  value: Record<string, unknown>,
  language: Language,
  log: (message: string) => void = console.error,
  now?: () => number,
): string {
  const core = readableAnswer(block, value, language);
  const display = block.display;
  if (!display) return core;
  try {
    const line = timed(`display of "${name}"`, () => display.call(block, structuredClone(value) as never, language), log, now);
    if (typeof line === "string" && line.trim()) return line.trim();
    log(`The display of "${name}" gave no text: the core's line is used`);
  } catch (err) {
    log(`The display of "${name}" failed (${err instanceof Error ? err.message : String(err)}): the core's line is used`);
  }
  return core;
}

/** The next turn's message (spec §4): a header, the readable line, then the exact JSON the agent relies on. */
export function answerMessage(o: { name: string; blockId: string; value: Record<string, unknown>; display: string; language: Language }): string {
  const json = JSON.stringify({ block: o.name, blockId: o.blockId, value: o.value });
  return `[${WORDS[o.language].answer} ${o.name}]\n${o.display}\n\n\`\`\`json\n${json}\n\`\`\``;
}

const ANSWER_FENCE = /```json\n([^\n]+)\n```\s*$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The answer a turn message carries (its last json fence), or null for any other message. */
export function readAnswer(message: string): { block: string; blockId: string; value: Record<string, unknown> } | null {
  const m = ANSWER_FENCE.exec(message);
  if (!m) return null;
  try {
    const parsed: unknown = JSON.parse(m[1]);
    if (isObject(parsed) && typeof parsed.block === "string" && typeof parsed.blockId === "string" && isObject(parsed.value)) {
      return { block: parsed.block, blockId: parsed.blockId, value: parsed.value };
    }
  } catch {
    // not an answer
  }
  return null;
}
```

In `packages/harness-sdk/src/index.ts`, after `export * from "./input";`, add:

```ts
export * from "./answer";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/harness-sdk/test`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/harness-sdk/src/answer.ts packages/harness-sdk/src/index.ts packages/harness-sdk/test/answer.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(sdk): answers: block ids, checks, the readable line and the turn message" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 4: The agent is told to wait; the block event carries an id; the `quiz` fixture

**Files:**
- Modify: `packages/runtime/src/events.ts`, `packages/blocks/src/ui-server.ts`
- Create: `packages/fake-agent/fixtures/input-harness/harness.config.ts`, `packages/fake-agent/fixtures/input-harness/agent/AGENTS.md`, `packages/fake-agent/fixtures/input-harness/agent/tasks/practice.md`
- Test: `packages/blocks/test/ui-server.test.ts`

- [ ] **Step 1: Create the fixture**

`packages/fake-agent/fixtures/input-harness/harness.config.ts`:

```ts
// Test fixture for input blocks: a tiny practice harness that asks the person to commit to an answer.
import { z } from "zod";
import { defineBlock, defineHarness } from "@humanharness/harness-sdk";

const card = defineBlock({
  description: "Shows a card with a title to the person.",
  visible: true,
  schema: z.object({ title: z.string().min(1).max(80) }),
  example: { title: "Card" },
});

const commit_answer = defineBlock({
  description: "Asks the person to commit to an answer before you explain: a question, up to 4 options, and why.",
  visible: true,
  schema: z.object({ question: z.string().min(1).max(300), options: z.array(z.string().min(1).max(120)).max(4).optional() }),
  input: z.object({ choice: z.string().max(120).optional(), why: z.string().min(1).max(1000) }),
  inputUi: { choice: { label: { es: "Elegí", en: "I pick" } }, why: { label: { es: "¿Por qué? Con tus palabras", en: "Why? In your own words" } } },
  submitLabel: { es: "Me comprometo", en: "I commit" },
  example: { question: "¿Quién comió más?", options: ["Yo", "Mi amiga", "Las dos igual"] },
});

const summary = defineBlock({
  description: "Asks the person to sum the topic up in their own words and to write flashcards.",
  visible: true,
  schema: z.object({ prompt: z.string().min(1).max(300) }),
  input: z.object({
    summary: z.string().min(1).max(2000),
    cards: z.array(z.object({ front: z.string().min(1).max(200), back: z.string().min(1).max(200) })).max(20),
  }),
  inputUi: { cards: { columns: { front: { es: "Frente", en: "Front" }, back: { es: "Dorso", en: "Back" } } } },
  skippable: true,
  example: { prompt: "Resumí el tema con tus palabras." },
});

export default defineHarness({
  id: "quiz",
  name: { es: "Quiz", en: "Quiz" },
  core: "^0.1.0",
  languages: ["es", "en"],
  engines: ["claude"],
  folder: { suggested: "Documents/Human Harness Quiz" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: { card, commit_answer, summary },
  actions: { practice: { label: { es: "Practicar", en: "Practice" }, prompt: "./agent/tasks/practice.md", cost: "light" } },
  path: ["practice"],
  author: "Human Harness tests",
});
```

`packages/fake-agent/fixtures/input-harness/agent/AGENTS.md`:

```markdown
# Quiz

You help the person practise: they commit to an answer before you explain.
```

`packages/fake-agent/fixtures/input-harness/agent/tasks/practice.md`:

```markdown
# Task: practice

Ask one question with `show_commit_answer`, then explain from the person's answer. Answer in {{language}}.

{{notesIndex}}
```

- [ ] **Step 2: Write the failing tests**

In `packages/blocks/test/ui-server.test.ts`:
- add `import { INPUT_DONE } from "../src/ui-server";`;
- after `FIXTURE`, add the second fixture;
- give `connect` a harness parameter.

```ts
const INPUT_FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/input-harness/harness.config.ts");
```

Replace `async function connect(received: BlockMessage[]) {` with `async function connect(received: BlockMessage[], harnessConfig = FIXTURE) {`, and `harnessConfig: FIXTURE` inside it with `harnessConfig`.

Append inside `describe("ui MCP server", …)`:

```ts
  it("tells the agent to wait after showing a block the person answers", async () => {
    const received: BlockMessage[] = [];
    const c = await connect(received, INPUT_FIXTURE);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name)).toContain("show_commit_answer");
    const result = await c.callTool({ name: "show_commit_answer", arguments: { question: "¿Quién comió más?", options: ["Yo", "Las dos igual"] } });
    expect((result.content as { text: string }[])[0].text).toBe(INPUT_DONE);
    expect(INPUT_DONE).toBe("Done: the person can see it and will answer; wait for their answer.");
    expect(received).toEqual([{ name: "commit_answer", data: { question: "¿Quién comió más?", options: ["Yo", "Las dos igual"] } }]);
  });

  it("D0: a block with no input keeps today's answer text", async () => {
    const c = await connect([]);
    const shown = await c.callTool({ name: "show_note", arguments: { title: "Hello", body: "World" } });
    expect((shown.content as { text: string }[])[0].text).toBe("Done: the person can see it now.");
    const state = await c.callTool({ name: "update_progress", arguments: { percent: 5 } });
    expect((state.content as { text: string }[])[0].text).toBe("Done: state updated.");
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/blocks/test/ui-server.test.ts`
Expected: FAIL (`INPUT_DONE` is not exported; the input block's call answers "Done: the person can see it now.").

- [ ] **Step 4: Implement**

In `packages/blocks/src/ui-server.ts`, above `createUiServer`, add:

```ts
/** What the agent reads after showing a block the person answers (input-blocks spec §4): the answer is the next message. */
export const INPUT_DONE = "Done: the person can see it and will answer; wait for their answer.";
```

and replace

```ts
        const text = block.visible ? "Done: the person can see it now." : "Done: state updated.";
```

with

```ts
        // Only input blocks get the new text: every other block's answer stays as it was (spec D0).
        const text = block.input ? INPUT_DONE : block.visible ? "Done: the person can see it now." : "Done: state updated.";
```

In `packages/runtime/src/events.ts`, replace

```ts
  | { type: "block"; name: string; data: unknown }
```

with

```ts
  /** `id`: set by the app on a block the person answers (input-blocks spec §4), never by an engine. */
  | { type: "block"; name: string; data: unknown; id?: string }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/blocks/test/ui-server.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green. (The root `tsconfig.json` includes `packages/fake-agent/fixtures`, so the fixture is typechecked.)

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/runtime/src/events.ts packages/blocks/src/ui-server.ts packages/blocks/test/ui-server.test.ts packages/fake-agent/fixtures/input-harness
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(blocks): an input block tells the agent to wait for the answer" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 5: `AGENTS.md` explains answers

**Files:**
- Modify: `packages/workspace/src/instructions.ts`
- Test: `packages/workspace/test/instructions.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/workspace/test/instructions.test.ts`:

```ts
describe("managedSection: input blocks", () => {
  const schemaOf = (s: z.ZodObject) => {
    const { $schema: _omit, ...rest } = z.toJSONSchema(s) as Record<string, unknown>;
    return JSON.stringify(rest);
  };
  const ask = defineBlock({
    description: "Asks why.",
    visible: true,
    schema: z.object({ question: z.string() }),
    input: z.object({ why: z.string().min(1) }),
    example: { question: "q" },
  });

  it("D0: without input blocks the section is exactly today's", () => {
    expect(managedSection({ language: "en", blocks })).toBe(
      [
        MANAGED_START,
        "## Environment (generated by Human Harness; do not edit)",
        "",
        "- Always answer in English.",
        "- You are running inside a desktop app: the person talks to you from an interface, not a terminal. Don't show commands or file paths unless asked.",
        "- Don't use your CLI's own interactive questions: ask in plain text or with the interface tools below.",
        "- Work only inside this folder. Keep messages short and clear.",
        "",
        "### Interface tools",
        "",
        "Call these tools to show things to the person or update their state.",
        "",
        "- `show_note`: Shows a note.",
        '  Example: `{"title":"Hi"}`',
        `  Schema: \`${schemaOf(blocks.note.schema)}\``,
        "- `update_progress`: Updates progress.",
        '  Example: `{"percent":10}`',
        `  Schema: \`${schemaOf(blocks.progress.schema)}\``,
        MANAGED_END,
        "",
      ].join("\n"),
    );
  });

  it("documents each input block's answer and how answers come back", () => {
    const en = managedSection({ language: "en", blocks: { ...blocks, ask } });
    expect(en).toContain(`- \`show_ask\`: Asks why.\n  Example: \`{"question":"q"}\`\n  Schema: \`${schemaOf(ask.schema)}\`\n  Answer: \`${schemaOf(ask.input!)}\``);
    expect(en).toContain(
      [
        "### Answers from input blocks",
        "",
        "- A tool with an `Answer` schema asks the person for something. After calling it, end your turn and wait: the answer comes as the next message.",
        "- That message starts with `[answer to <block>]`, then what the person sees, then a ```json block with `block`, `blockId` and `value`. Trust the JSON: `value` already matches the block's `Answer` schema.",
        '- When `value` is `{"skipped": true}`, the person skipped the question: go on without insisting.',
      ].join("\n"),
    );
    expect(en.match(/Answer: /g)).toHaveLength(1);
    const es = managedSection({ language: "es", blocks: { ask } });
    expect(es).toContain(`  Respuesta: \`${schemaOf(ask.input!)}\``);
    expect(es).toContain("### Respuestas de bloques de entrada");
    expect(es).toContain("- Si `value` es `{\"skipped\": true}`, la persona salteó la pregunta: seguí sin insistir.");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/workspace/test/instructions.test.ts`
Expected: the D0 test PASSES (it pins today's text) and the input test FAILS (no `Answer:` line).

- [ ] **Step 3: Implement**

In `packages/workspace/src/instructions.ts`:

1. Widen the `TEXT` type: add `answer: string; answers: string; answerRules: string[]` to the record's value type.

2. Add to `es`:

```ts
    answer: "Respuesta",
    answers: "### Respuestas de bloques de entrada",
    answerRules: [
      "Una herramienta con schema `Respuesta` le pide algo a la persona. Después de llamarla, terminá tu turno y esperá: la respuesta llega como el próximo mensaje.",
      "Ese mensaje empieza con `[respuesta a <bloque>]`, sigue con lo que ve la persona y termina con un bloque ```json con `block`, `blockId` y `value`. Confiá en el JSON: `value` ya cumple el schema `Respuesta` del bloque.",
      'Si `value` es `{"skipped": true}`, la persona salteó la pregunta: seguí sin insistir.',
    ],
```

3. Add to `en`:

```ts
    answer: "Answer",
    answers: "### Answers from input blocks",
    answerRules: [
      "A tool with an `Answer` schema asks the person for something. After calling it, end your turn and wait: the answer comes as the next message.",
      "That message starts with `[answer to <block>]`, then what the person sees, then a ```json block with `block`, `blockId` and `value`. Trust the JSON: `value` already matches the block's `Answer` schema.",
      'When `value` is `{"skipped": true}`, the person skipped the question: go on without insisting.',
    ],
```

4. In `managedSection`, replace the tools loop and its closing brace with:

```ts
    for (const [name, block] of entries) {
      lines.push(
        `- \`${blockToolName(name, block)}\`: ${block.description}`,
        `  ${t.example}: \`${JSON.stringify(block.example)}\``,
        `  ${t.schema}: \`${toolSchema(block.schema)}\``,
      );
      if (block.input) lines.push(`  ${t.answer}: \`${toolSchema(block.input)}\``);
    }
    // Only a harness with input blocks gets the answers section (spec D0).
    if (entries.some(([, b]) => b.input)) lines.push("", t.answers, "", ...t.answerRules.map((r) => `- ${r}`));
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/workspace/test/instructions.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/workspace/src/instructions.ts packages/workspace/test/instructions.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(workspace): AGENTS.md explains how answers come back" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 6: Block ids in turns and in the chat log; the answer is kept on its block

**Files:**
- Modify: `packages/shell/src/main/turn-controller.ts`, `packages/shell/src/main/chat-log.ts`, `packages/ui/src/client.ts`
- Test: `packages/shell/test/turn-controller.test.ts`, `packages/shell/test/chat-log.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/shell/test/turn-controller.test.ts`, give `setup` an `inputBlocks` option:
- add `inputBlocks?: string[];` to its `opts` type;
- add this line to the `new TurnController({ … })` object, after `stateBlocks: () => new Set(),`:

```ts
    ...(opts.inputBlocks ? { inputBlocks: () => new Set(opts.inputBlocks) } : {}),
```

Append:

```ts
describe("TurnController: input block ids", () => {
  const card: Event = { type: "block", name: "card", data: { t: "a" } };
  const ask: Event = { type: "block", name: "commit_answer", data: { question: "q" } };

  it("stamps <task>:<turn>:<index> on the input blocks of a task's run turn, for the window and the log", async () => {
    const fake = fakeRuntime();
    const { controller, entries, events } = setup({ ensureRuntime: async () => fake.runtime, inputBlocks: ["commit_answer"] });
    const sent = controller.send("hi", { task: "t1", turn: 2 });
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    fake.finish([card, ask, { type: "done", ok: true }]);
    await sent;
    expect(events.filter((e) => e.type === "block")).toEqual([card, { ...ask, id: "t1:2:1" }]);
    expect(entries.at(-1)?.blocks).toEqual([
      { name: "card", data: { t: "a" } },
      { name: "commit_answer", data: { question: "q" }, id: "t1:2:1" },
    ]);
  });

  it("D0: no id without a turn number, outside a task, in a closing turn, or for a block with no input", async () => {
    const cases: [TurnOptions, string[]][] = [
      [{ task: "t1" }, ["commit_answer"]],
      [{ turn: 0 }, ["commit_answer"]],
      [{ task: "t1", turn: 0, phase: "close" }, ["commit_answer"]],
      [{ task: "t1", turn: 0 }, []],
    ];
    for (const [options, inputBlocks] of cases) {
      const fake = fakeRuntime();
      const { controller, events } = setup({ ensureRuntime: async () => fake.runtime, inputBlocks });
      const sent = controller.send("hi", options);
      await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
      fake.finish([ask, { type: "done", ok: true }]);
      await sent;
      expect(events.find((e) => e.type === "block")).toEqual(ask);
    }
  });
});
```

Add `type TurnOptions` to the import from `../src/main/turn-controller`.

Append to `packages/shell/test/chat-log.test.ts` (inside `describe("ChatLog", …)`):

```ts
  it("puts an answer on its block, once, rewriting the file and keeping broken lines", async () => {
    const folder = fs.mkdtempSync(path.join(root, "f-"));
    const log = new ChatLog(folder, "claude");
    await log.append({ id: "1", role: "assistant", text: "", blocks: [{ name: "commit_answer", data: { question: "q" }, id: "t1:0:0" }], activities: [], at: "t1" });
    fs.appendFileSync(path.join(folder, ".harness", "chats", "main.jsonl"), "{broken\n");
    const answer = { blockId: "t1:0:0", value: { why: "porque" }, answeredAt: "2026-10-25T10:00:00.000Z" };
    expect(await log.markAnswered(answer)).toBe(true);
    expect(await log.markAnswered(answer)).toBe(false);
    expect(await log.markAnswered({ ...answer, blockId: "t9:0:0" })).toBe(false);
    const [entry] = await log.load();
    expect(entry.blocks[0]).toEqual({ name: "commit_answer", data: { question: "q" }, id: "t1:0:0", input: answer });
    expect(entry.engine).toBe("claude");
    expect(fs.readFileSync(path.join(folder, ".harness", "chats", "main.jsonl"), "utf8")).toContain("{broken\n");
  });

  it("an id survives the recorder", () => {
    const r = new TurnRecorder(new Set());
    r.add({ type: "block", name: "commit_answer", data: { question: "q" }, id: "t1:0:0" });
    r.add({ type: "block", name: "card", data: {} });
    expect(r.finish({ type: "done", ok: true }).blocks).toEqual([
      { name: "commit_answer", data: { question: "q" }, id: "t1:0:0" },
      { name: "card", data: {} },
    ]);
  });
```

(The main chat is `<folder>/.harness/chats/main.jsonl`: `chatFile(folder, "main")` in `packages/workspace/src/layout.ts`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/shell/test/turn-controller.test.ts packages/shell/test/chat-log.test.ts`
Expected: FAIL (`turn` is not a TurnOptions field; `markAnswered` does not exist; the recorder drops `id`).

- [ ] **Step 3: Implement**

In `packages/ui/src/client.ts`:
- add `BlockAnswer` to the `import type { … } from "@humanharness/harness-sdk"` list;
- above `ChatEntry`, add:

```ts
/** A block in the chat. Input blocks carry the id the app gave them and, once answered, the answer (input-blocks spec §8). */
export interface ChatBlock {
  name: string;
  data: unknown;
  id?: string;
  input?: BlockAnswer;
}
```

and in `ChatEntry` replace `blocks: { name: string; data: unknown }[];` with `blocks: ChatBlock[];`.

In `packages/shell/src/main/chat-log.ts`:
- add `import type { BlockAnswer } from "@humanharness/harness-sdk";`;
- in `TurnRecorder.add`, replace `else this.blocks.push({ name: e.name, data: e.data });` with:

```ts
      else this.blocks.push({ name: e.name, data: e.data, ...(e.id ? { id: e.id } : {}) });
```

and add to `ChatLog`, after `load`:

```ts
  /**
   * Puts the person's answer on the block it answers (input-blocks spec §8). The file is rewritten atomically
   * (temp + rename), keeping every other line as it was. False when no unanswered block has that id.
   */
  async markAnswered(answer: BlockAnswer): Promise<boolean> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file, "utf8");
    } catch {
      return false;
    }
    let found = false;
    const lines = raw.split("\n").map((line) => {
      if (found || !line.trim()) return line;
      let entry: ChatEntry;
      try {
        entry = JSON.parse(line) as ChatEntry;
      } catch {
        return line;
      }
      const i = Array.isArray(entry.blocks) ? entry.blocks.findIndex((b) => b.id === answer.blockId && b.input === undefined) : -1;
      if (i < 0) return line;
      found = true;
      return JSON.stringify({ ...entry, blocks: entry.blocks.map((b, j) => (j === i ? { ...b, input: answer } : b)) });
    });
    if (!found) return false;
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, lines.join("\n"));
      await fs.rename(tmp, this.file);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
    return true;
  }
```

In `packages/shell/src/main/turn-controller.ts`:
- add `import { blockIdOf } from "@humanharness/harness-sdk";`;
- add to `TurnOptions`:

```ts
  /**
   * The task's finished-turn count when this turn starts. With `task`, in a run turn, each block the person answers
   * gets the id `<task>:<turn>:<index>` (input-blocks spec §4). Absent: no ids (spec D0).
   */
  turn?: number;
```

- add to `TurnDeps`:

```ts
  /** The names of the blocks the person answers. Absent: none (spec D0). */
  inputBlocks?: () => Set<string>;
```

- in `run`, add `turn` to the destructured options;
- after `const recorder = new TurnRecorder(this.deps.stateBlocks());`, add:

```ts
      // Every block event counts toward the index; only input blocks of a task's run turn get an id.
      const inputs = turn !== undefined && task && (phase ?? "run") === "run" ? this.deps.inputBlocks?.() : undefined;
      let blockIndex = 0;
      const stamp = (e: Event): Event => {
        if (e.type !== "block") return e;
        const index = blockIndex++;
        return inputs?.has(e.name) && task && turn !== undefined ? { ...e, id: blockIdOf(task, turn, index) } : e;
      };
```

- in the `rt.send` callback, rename the parameter to `raw` and start the callback with `const e = stamp(raw);`:

```ts
      turn.running = rt.send(message, (raw) => {
        const e = stamp(raw);
        if (e.type === "done") finished = finish(e);
```

  (The rest of the callback is unchanged. The local `turn` that holds the running turn shadows nothing: the option is destructured as `turn` and the running-turn record is also named `turn`. Rename the running-turn record to `current`, in `run` only, to keep them apart:
  - `const current: { cancelled: boolean; running: RunningTurn | null } = { cancelled: false, running: null };`
  - `this.turn = current;`
  - `if (current.cancelled) …` (both places)
  - `current.running = rt.send(…)`
  - `await current.running.done;`)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/shell/test/turn-controller.test.ts packages/shell/test/chat-log.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, app build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, then `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/turn-controller.ts packages/shell/src/main/chat-log.ts packages/ui/src/client.ts packages/shell/test/turn-controller.test.ts packages/shell/test/chat-log.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): input blocks get ids, and the chat keeps their answers" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 7: The task records the question it waits on

**Files:**
- Modify: `packages/shell/src/main/task-store.ts`, `packages/shell/src/main/task-manager.ts`, `packages/ui/src/client.ts`
- Test: `packages/shell/test/task-manager-input.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/shell/test/task-manager-input.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ModelProfile } from "@humanharness/engines";
import { type InputBlock, answerMessage, defineBlock, z } from "@humanharness/harness-sdk";
import type { Event } from "@humanharness/runtime";
import type { TaskView } from "@humanharness/ui/client";
import { type TaskDeps, TaskManager } from "../src/main/task-manager";
import { CHECKPOINT_PROMPT } from "../src/main/task-prompts";
import { TaskStore, type TasksFile, emptyTasks } from "../src/main/task-store";
import type { TurnOptions } from "../src/main/turn-controller";

const commit = defineBlock({
  description: "Commit.",
  visible: true,
  schema: z.object({ question: z.string() }),
  input: z.object({ why: z.string().min(1) }),
  inputUi: { why: { label: { es: "Por qué", en: "Why" } } },
  skippable: true,
  example: { question: "q" },
}) as InputBlock;
const ok: Event = { type: "done", ok: true };
const cancelled: Event = { type: "done", ok: false, error: { code: "cancelled" } };
const shown = (id: string): Event => ({ type: "block", name: "commit_answer", data: { question: "¿Por qué?" }, id });
const NOW = "2026-10-25T10:00:00.000Z";

/** A task manager over memory, for a harness whose `commit_answer` block the person answers. */
function setup(
  opts: {
    script?: Event[][];
    state?: TasksFile;
    /** false: a harness with no input block (spec D0). */
    inputs?: false | Record<string, InputBlock>;
    gate?: Promise<void>;
    sendError?: Error;
    saveAnswer?: TaskDeps["saveAnswer"];
  } = {},
) {
  let state = opts.state ?? emptyTasks();
  const script = [...(opts.script ?? [])];
  const turns: { message: string; options: TurnOptions }[] = [];
  const views: TaskView[] = [];
  const emitted: Event[] = [];
  const marked: unknown[] = [];
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
      cancel: () => {},
      send: async (message, options) => {
        if (opts.sendError) throw opts.sendError;
        busy = true;
        turns.push({ message, options });
        await opts.gate;
        for (const e of script.shift() ?? [ok]) options.onEvent?.(e);
        busy = false;
      },
    },
    actions: { practice: { label: { es: "Practicar", en: "Practice" } } },
    path: ["practice"],
    readPrompt: async () => "# Task: practice\n\n{{notesIndex}}",
    language: async () => "en",
    engine: async () => "claude",
    notes: async () => [],
    writeNote: async () => {},
    endSession: async () => {},
    changed: (v) => views.push(v),
    emit: (e) => void emitted.push(e),
    ...(opts.inputs === false ? {} : { inputBlocks: opts.inputs ?? { commit_answer: commit } }),
    markAnswered: async (chat, answer) => void marked.push({ chat, answer }),
    ...(opts.saveAnswer ? { saveAnswer: opts.saveAnswer } : {}),
    now: () => new Date(NOW),
    newId: () => `t${++n}`,
  });
  return { manager, turns, views, emitted, marked, state: () => state };
}

describe("TaskManager: the pending input", () => {
  it("records the input block a run turn shows, while the turn runs, and the view names it", async () => {
    const t = setup({ script: [[shown("t1:0:0"), ok]] });
    await t.manager.start("practice");
    expect(t.turns[0].options.turn).toBe(0);
    expect(t.state().current?.pendingInput).toEqual({ blockId: "t1:0:0", block: "commit_answer", shownAt: NOW });
    // The window knew before the turn ended: the first view naming it still shows the task running.
    expect(t.views.find((v) => v.current?.pendingInput)?.current?.status).toBe("running");
    expect(t.views.at(-1)?.current).toMatchObject({ status: "waiting", pendingInput: "t1:0:0" });
  });

  it("a newer input block replaces it (D5); a typed follow-up keeps it", async () => {
    const t = setup({ script: [[shown("t1:0:0"), shown("t1:0:1"), ok], [ok]] });
    await t.manager.start("practice");
    expect(t.state().current?.pendingInput?.blockId).toBe("t1:0:1");
    await t.manager.ask("What do you mean?");
    expect(t.turns[1].options.turn).toBe(1);
    expect(t.state().current?.pendingInput?.blockId).toBe("t1:0:1");
  });

  it("D0: without input blocks, no turn number and nothing pending", async () => {
    const t = setup({ inputs: false, script: [[shown("t1:0:0"), ok]] });
    await t.manager.start("practice");
    expect(t.turns[0].options).not.toHaveProperty("turn");
    expect(t.state().current).not.toHaveProperty("pendingInput");
    expect(t.views.at(-1)?.current).not.toHaveProperty("pendingInput");
  });

  it("tasks.json keeps a well-formed pending input and drops a bad one", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-pending-"));
    try {
      const store = new TaskStore(folder);
      const current = { id: "t1", status: "waiting", startedAt: "", turns: 1 };
      const write = (pendingInput: unknown) => {
        fs.mkdirSync(path.dirname(store.file), { recursive: true });
        fs.writeFileSync(store.file, JSON.stringify({ version: 1, actions: {}, current: { ...current, pendingInput } }));
      };
      write({ blockId: "t1:0:0", block: "commit_answer", shownAt: NOW });
      expect((await store.load()).current?.pendingInput).toEqual({ blockId: "t1:0:0", block: "commit_answer", shownAt: NOW });
      for (const bad of [{ blockId: "../t1:0:0", block: "commit_answer", shownAt: NOW }, { blockId: "t1:0:0", block: "Bad Name", shownAt: NOW }, "t1:0:0"]) {
        write(bad);
        expect((await store.load()).current).not.toHaveProperty("pendingInput");
      }
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});
```

(`ModelProfile`, `answerMessage`, `CHECKPOINT_PROMPT` and `cancelled` are used by Task 8's tests in this file; with `noUnusedLocals` off in this repo's tsconfig they don't fail the typecheck before then.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/task-manager-input.test.ts`
Expected: FAIL (`inputBlocks`, `markAnswered` and `saveAnswer` are not TaskDeps fields; nothing is pending).

- [ ] **Step 3: Implement**

`packages/shell/src/main/task-store.ts`:
- change the harness-sdk import to `import { BLOCK_ID } from "@humanharness/harness-sdk";` (a new import line);
- above `CurrentTask`, add:

```ts
/** The input block the task waits an answer for (input-blocks spec §4): its id, its block's name, when it was shown. */
export interface PendingInput {
  blockId: string;
  block: string;
  shownAt: string;
}
```

- add to `CurrentTask`:

```ts
  /** The question the task waits on: the last input block shown (spec D5). Absent in a harness with none (D0). */
  pendingInput?: PendingInput;
```

- above `cleanCurrent`, add:

```ts
const BLOCK_NAME = /^[a-z][a-z0-9_]*$/;

function cleanPending(p: unknown): PendingInput | undefined {
  if (!isObject(p) || typeof p.blockId !== "string" || !BLOCK_ID.test(p.blockId)) return undefined;
  if (typeof p.block !== "string" || !BLOCK_NAME.test(p.block) || typeof p.shownAt !== "string") return undefined;
  return { blockId: p.blockId, block: p.block, shownAt: p.shownAt };
}
```

- in `cleanCurrent`, add `const pending = cleanPending(c.pendingInput);` next to `const profile = …`, and as the object's last line `...(pending ? { pendingInput: pending } : {}),`.

`packages/ui/src/client.ts`, in `CurrentTaskView`, add:

```ts
  /** The id of the input block the task waits an answer for (input-blocks spec §4). */
  pendingInput?: string;
```

`packages/shell/src/main/task-manager.ts`:
- add `type InputBlock` to the harness-sdk import;
- add to `TaskDeps`:

```ts
  /** The harness's blocks the person answers, by name (input-blocks spec). Absent or empty: none (spec D0). */
  inputBlocks?: Record<string, InputBlock>;
```

- in `currentView`, after the `scope` line, add:

```ts
  ...(c.pendingInput ? { pendingInput: c.pendingInput.blockId } : {}),
```

- add a private helper after `known`:

```ts
  /** The harness has blocks the person answers: turns number their ids (spec D0 keeps every other harness as is). */
  private hasInputs(): boolean {
    return Object.keys(this.d.inputBlocks ?? {}).length > 0;
  }
```

- in `runTurn`:
  - add `const shownInputs: Promise<void>[] = [];` after `const seen = …`;
  - in the options passed to `this.d.turns.send`, after the `profile` spread, add:

```ts
        // Input blocks get ids only in run turns, and only in a harness that has them.
        ...(this.hasInputs() && (options.phase ?? "run") === "run" ? { turn: task.turns } : {}),
```

  - in `onEvent`, after the `save_note` branch, add:

```ts
          } else if (e.type === "block" && e.id !== undefined && this.d.inputBlocks && Object.hasOwn(this.d.inputBlocks, e.name)) {
            shownInputs.push(this.showInput(task.id, e.name, e.id));
```

  - right after the `try { … } catch { … } finally { … }` statement, add `await Promise.all(shownInputs);`.

- add the method after `saveNote`:

```ts
  /**
   * An input block shown in task `id`'s turn becomes its pending input, replacing any earlier one (spec D5). Saved
   * as the event arrives, so the window knows the question before the turn ends. A failure is logged.
   */
  private showInput(id: string, block: string, blockId: string): Promise<void> {
    const shownAt = this.now().toISOString();
    return this.update((s) => (s.current?.id === id ? { ...s, current: { ...s.current, pendingInput: { blockId, block, shownAt } } } : s)).catch((err: unknown) =>
      console.error("Could not record the question shown", err),
    );
  }
```

- [ ] **Step 4: Run the test to verify it passes**

The file's `setup` passes `markAnswered` and `saveAnswer`, which Tasks 8 and 15 add to `TaskDeps`. Until then, add both now as optional fields (Tasks 8 and 15 give them their meaning):

```ts
  /** Puts an answer on its block in the chat of `chat` (input-blocks spec §8). */
  markAnswered?(chat: string, answer: BlockAnswer): Promise<void>;
  /** Writes an answer's records to a data collection, as the person, in `scope` (spec §6 `saveTo`). Throws a refusal. */
  saveAnswer?(collection: string, records: Record<string, unknown>[], scope: string): Promise<void>;
```

with `type BlockAnswer` added to the harness-sdk import.

Run: `corepack pnpm vitest run packages/shell/test/task-manager-input.test.ts packages/shell/test`
Expected: PASS (the new file and every existing shell test: no other harness passes `inputBlocks`).

- [ ] **Step 5: Typecheck, full tests, app build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, then `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/task-store.ts packages/shell/src/main/task-manager.ts packages/ui/src/client.ts packages/shell/test/task-manager-input.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): the task records the question it waits on" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 8: `TaskManager.respond`

**Files:**
- Modify: `packages/shell/src/main/task-manager.ts`
- Test: `packages/shell/test/task-manager-input.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shell/test/task-manager-input.test.ts`:

```ts
describe("TaskManager.respond", () => {
  const profile: ModelProfile = { engine: "claude", tier: "standard", model: "sonnet", effort: "medium", cap: 1000 };
  const waiting = (extra: Record<string, unknown> = {}): TasksFile => ({
    ...emptyTasks(),
    current: {
      id: "t1",
      action: "practice",
      status: "waiting",
      startedAt: "",
      turns: 1,
      pendingInput: { blockId: "t1:0:0", block: "commit_answer", shownAt: NOW },
      ...extra,
    } as TasksFile["current"],
  });

  it("takes a valid answer: marks the chat, clears the question and sends the readable line with the JSON", async () => {
    const t = setup({ state: waiting() });
    const { accepted, done } = t.manager.respond("t1:0:0", { why: "porque sí", extra: 1 });
    expect(await accepted).toEqual({ ok: true, display: "Why: porque sí", value: { why: "porque sí" }, answeredAt: NOW });
    await done;
    expect(t.marked).toEqual([{ chat: "main", answer: { blockId: "t1:0:0", value: { why: "porque sí" }, answeredAt: NOW } }]);
    expect(t.turns).toHaveLength(1);
    expect(t.turns[0].message).toBe(answerMessage({ name: "commit_answer", blockId: "t1:0:0", value: { why: "porque sí" }, display: "Why: porque sí", language: "en" }));
    expect(t.turns[0].options).toMatchObject({ display: "Why: porque sí", followUp: true, task: "t1", turn: 1, phase: "run" });
    expect(t.state().current).not.toHaveProperty("pendingInput");
    expect(t.state().current).toMatchObject({ status: "waiting", turns: 2 });
  });

  it("takes a skip from a skippable block", async () => {
    const t = setup({ state: waiting() });
    const { accepted, done } = t.manager.respond("t1:0:0", { skipped: true });
    expect(await accepted).toMatchObject({ ok: true, display: "(skipped)", value: { skipped: true } });
    await done;
    expect(t.turns[0].message).toContain('"value":{"skipped":true}');
  });

  it("refuses a stale block, a closed question, a task that isn't waiting or no task, and runs nothing", async () => {
    const cases: [TasksFile, string][] = [
      [waiting(), "t1:0:9"],
      [waiting({ pendingInput: undefined }), "t1:0:0"],
      [waiting({ status: "closing" }), "t1:0:0"],
      [emptyTasks(), "t1:0:0"],
    ];
    for (const [state, id] of cases) {
      const t = setup({ state });
      const { accepted, done } = t.manager.respond(id, { why: "x" });
      expect(await accepted).toMatchObject({ ok: false, reason: "stale" });
      await done;
      expect(t.turns).toEqual([]);
      expect(t.marked).toEqual([]);
    }
  });

  it("refuses an invalid answer with its field errors; the question stays open", async () => {
    const t = setup({ state: waiting() });
    const { accepted, done } = t.manager.respond("t1:0:0", { why: "" });
    const r = await accepted;
    expect(r).toMatchObject({ ok: false, reason: "invalid" });
    if (!r.ok) expect(r.errors.map((e) => e.path)).toEqual(["why"]);
    await done;
    expect(t.turns).toEqual([]);
    expect(t.state().current?.pendingInput?.blockId).toBe("t1:0:0");
  });

  it("runs a due checkpoint before the answer is taken, and only once (spec §6)", async () => {
    const t = setup({ state: waiting({ profile, context: { used: 900 } }) });
    const { accepted, done } = t.manager.respond("t1:0:0", { why: "x" });
    expect((await accepted).ok).toBe(true);
    await done;
    expect(t.turns.map((x) => x.options.phase)).toEqual(["checkpoint", "run"]);
    expect(t.turns[0].message).toBe(CHECKPOINT_PROMPT);
    expect(t.marked).toHaveLength(1);
  });

  it("a stopped checkpoint takes nothing: the question stays open and the window gets no event", async () => {
    const t = setup({ state: waiting({ profile, context: { used: 900 } }), script: [[cancelled]] });
    const { accepted, done } = t.manager.respond("t1:0:0", { why: "x" });
    expect(await accepted).toMatchObject({ ok: false, reason: "stopped" });
    await done;
    expect(t.turns).toHaveLength(1);
    expect(t.marked).toEqual([]);
    expect(t.emitted).toEqual([]);
    expect(t.state().current).toMatchObject({ status: "waiting", pendingInput: { blockId: "t1:0:0" } });
  });

  it("refuses while a turn runs: both promises reject", async () => {
    let open!: () => void;
    const t = setup({ state: waiting(), gate: new Promise<void>((r) => (open = r)) });
    const first = t.manager.respond("t1:0:0", { why: "x" });
    await first.accepted;
    const second = t.manager.respond("t1:0:0", { why: "y" });
    await expect(second.accepted).rejects.toThrow("A turn is already running");
    await expect(second.done).rejects.toThrow("A turn is already running");
    open();
    await first.done;
  });

  it("a turn that can't start after the answer was taken ends the window's turn with an error", async () => {
    const t = setup({ state: waiting(), sendError: new Error("The app is closing") });
    const { accepted, done } = t.manager.respond("t1:0:0", { why: "x" });
    expect((await accepted).ok).toBe(true);
    await expect(done).rejects.toThrow("The app is closing");
    expect(t.emitted).toEqual([{ type: "done", ok: false, error: { code: "agent-crashed", detail: "The app is closing" } }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/shell/test/task-manager-input.test.ts`
Expected: FAIL (`respond` is not a method).

- [ ] **Step 3: Implement**

In `packages/shell/src/main/task-manager.ts`:
- add `type RespondResult, answerDisplay, answerMessage, parseAnswer` to the harness-sdk import;
- after `choose`, add:

```ts
  /**
   * The person's answer to input block `blockId` (input-blocks spec §6). `accepted` resolves once the answer is
   * refused (nothing ran, nothing changed) or taken (the chat's line comes with it); `done` once the turn that
   * carries it to the agent has ended. Both reject when the operation can't run (closing, a turn running).
   */
  respond(blockId: string, value: unknown): { accepted: Promise<RespondResult>; done: Promise<void> } {
    let settled = false;
    let take!: (r: RespondResult) => void;
    let refuse!: (err: unknown) => void;
    const accepted = new Promise<RespondResult>((resolve, reject) => {
      take = (r) => {
        settled = true;
        resolve(r);
      };
      refuse = reject;
    });
    const done = this.op(() => this.respondNow(blockId, value, take)).then(
      () => {
        if (!settled) refuse(new Error("The answer was not taken"));
      },
      (err: unknown) => {
        if (!settled) refuse(err);
        throw err;
      },
    );
    return { accepted, done };
  }
```

- after `chooseNow`, add:

```ts
  /**
   * Checks, in order: the question is the waiting task's open one; the answer is valid; the checkpoint runs if due
   * (before anything is taken, spec §6). Then the question closes, the chat marks the answer, the window gets the
   * line, and the answer goes to the agent as a follow-up. `askNow` then sees `checkpointed` and runs no second one.
   */
  private async respondNow(blockId: string, raw: unknown, take: (r: RespondResult) => void): Promise<void> {
    const refuse = (reason: Exclude<RespondResult, { ok: true }>["reason"], errors: { path: string; message: string }[] = []) =>
      take({ ok: false, reason, errors });
    const c = await this.storedCurrent();
    const pending = c?.pendingInput;
    const block = pending && this.d.inputBlocks?.[pending.block];
    if (!c || c.status !== "waiting" || !pending || pending.blockId !== blockId || !block) {
      return refuse("stale", [{ path: "", message: "This question is closed" }]);
    }
    const parsed = parseAnswer(block, raw);
    if (!parsed.ok) return refuse("invalid", parsed.errors);
    if (needsCheckpoint(c)) {
      if (!(await this.checkpoint(c))) return refuse("stopped");
      await this.setStatus(c.id, "waiting");
    }
    const language = await this.d.language();
    const display = answerDisplay(pending.block, block, parsed.value, language);
    const answer = { blockId, value: parsed.value, answeredAt: this.now().toISOString() };
    await this.update((s) => {
      if (s.current?.id !== c.id) return s;
      const { pendingInput: _answered, ...rest } = s.current;
      return { ...s, current: rest };
    });
    await this.markAnswered(answer);
    take({ ok: true, display, value: answer.value, answeredAt: answer.answeredAt });
    try {
      await this.askNow(answerMessage({ name: pending.block, blockId, value: parsed.value, display, language }), display);
    } catch (err) {
      // The window already shows the person's line and a running turn: end it there.
      if (!this.windowDone) {
        this.windowDone = true;
        try {
          this.d.emit?.(fail("agent-crashed", err instanceof Error ? err.message : String(err)));
        } catch (emitErr) {
          console.error("Could not send an event to the window", emitErr);
        }
      }
      throw err;
    }
  }

  /** The answer goes on its block in the chat on screen (the task's: switching scope closes the task). Logged on failure. */
  private async markAnswered(answer: { blockId: string; value: Record<string, unknown>; answeredAt: string }): Promise<void> {
    try {
      await this.d.markAnswered?.(this.chatOf(await this.d.store.load()), answer);
    } catch (err) {
      console.error("Could not mark the answer in the chat", err);
    }
  }
```

  (`chatOf` answers `main` without scopes, which is what the test expects.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/shell/test/task-manager-input.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, app build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, then `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/task-manager.ts packages/shell/test/task-manager-input.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): the task takes the person's answer and sends it to the agent" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 9: `client.respond` and the app wiring

**Files:**
- Create: `packages/shell/src/main/respond-ipc.ts`
- Modify: `packages/shell/src/main/index.ts`, `packages/shell/src/preload/index.ts`, `packages/ui/src/client.ts`, `packages/ui/test/fake-client.ts`
- Test: `packages/shell/test/respond-ipc.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/shell/test/respond-ipc.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { RespondResult } from "@humanharness/harness-sdk";
import { type RespondDeps, respondHandler } from "../src/main/respond-ipc";

function deps(over: Partial<RespondDeps> = {}) {
  const calls: [string, Record<string, unknown>][] = [];
  const d: RespondDeps = {
    quitting: () => false,
    blocked: () => null,
    respond: (blockId, value) => {
      calls.push([blockId, value]);
      const r: RespondResult = { ok: true, display: "d", value, answeredAt: "a" };
      return { accepted: Promise.resolve(r), done: Promise.resolve() };
    },
    ...over,
  };
  return { d, calls };
}

describe("hh:respond", () => {
  it("passes a well-formed answer on and returns its acceptance", async () => {
    const { d, calls } = deps();
    expect(await respondHandler(d)("t1:0:0", { why: "x" })).toEqual({ ok: true, display: "d", value: { why: "x" }, answeredAt: "a" });
    expect(calls).toEqual([["t1:0:0", { why: "x" }]]);
  });

  it("refuses while quitting or while turns are blocked, and a bad id or value, before the task manager", async () => {
    const quitting = deps({ quitting: () => true });
    await expect(respondHandler(quitting.d)("t1:0:0", {})).rejects.toThrow("The app is closing");
    const blocked = deps({ blocked: () => "The folder is moving" });
    await expect(respondHandler(blocked.d)("t1:0:0", {})).rejects.toThrow("The folder is moving");
    const { d, calls } = deps();
    for (const [id, value] of [["../x", {}], [42, {}], ["t1:0:0", null], ["t1:0:0", ["a"]], ["t1:0:0", "x"]] as [unknown, unknown][]) {
      await expect(respondHandler(d)(id, value)).rejects.toThrow("Invalid answer");
    }
    expect(calls).toEqual([]);
  });

  it("a failed turn after the answer is only logged", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const r: RespondResult = { ok: true, display: "d", value: {}, answeredAt: "a" };
    const { d } = deps({ respond: () => ({ accepted: Promise.resolve(r), done: Promise.reject(new Error("boom")) }) });
    expect(await respondHandler(d)("t1:0:0", {})).toEqual(r);
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith("The answer's turn failed", expect.any(Error)));
    log.mockRestore();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/respond-ipc.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `packages/shell/src/main/respond-ipc.ts`:

```ts
import { BLOCK_ID, type RespondResult } from "@humanharness/harness-sdk";

export interface RespondDeps {
  quitting(): boolean;
  /** Why a new turn can't start now, or null. */
  blocked(): string | null;
  respond(blockId: string, value: Record<string, unknown>): { accepted: Promise<RespondResult>; done: Promise<void> };
}

/**
 * The handler of `hh:respond` (input-blocks spec §4). It answers with the acceptance as a value: a refusal's field
 * errors survive Electron's IPC, which keeps only a thrown error's message. The turn after it reaches the window
 * as events; its failure is only logged here.
 */
export function respondHandler(d: RespondDeps): (blockId: unknown, value: unknown) => Promise<RespondResult> {
  return async (blockId, value) => {
    if (d.quitting()) throw new Error("The app is closing");
    const blocked = d.blocked();
    if (blocked) throw new Error(blocked);
    if (typeof blockId !== "string" || !BLOCK_ID.test(blockId)) throw new Error("Invalid answer");
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid answer");
    const { accepted, done } = d.respond(blockId, value as Record<string, unknown>);
    done.catch((err: unknown) => console.error("The answer's turn failed", err));
    return accepted;
  };
}
```

In `packages/ui/src/client.ts`:
- add `InputField, InputIssue, InputSpec, RespondResult` to the harness-sdk type import;
- change the last line to `export type { BlockAnswer, ChoiceOption, Event, EngineError, InputField, InputIssue, InputSpec, LimitWindow, RespondResult };`;
- add to `AppState`, after `scopes`:

```ts
  /** The blocks the person answers, by name: how the core form draws each (input-blocks spec §5). Absent: none (D0). */
  inputs?: Record<string, InputSpec>;
```

- add to `HarnessClient`, after `choose`:

```ts
  /**
   * The person's answer to input block `blockId` (input-blocks spec §4). Resolves with the refusal and its field
   * errors, or with the chat's line once the answer is taken; the agent's turn then arrives as events.
   */
  respond(blockId: string, value: Record<string, unknown>): Promise<RespondResult>;
```

In `packages/shell/src/preload/index.ts`, after the `choose` line, add:

```ts
  respond: (blockId, value) => ipcRenderer.invoke("hh:respond", blockId, value),
```

In `packages/shell/src/main/index.ts`:
- add `inputBlocks, inputSpecs` to the harness-sdk import, and `import { respondHandler } from "./respond-ipc";`;
- in `appState()`, after the `scopes` spread, add:

```ts
    // Only a harness with input blocks sends their specs (spec D0).
    ...(Object.keys(inputSpecs(harness.blocks)).length > 0 ? { inputs: inputSpecs(harness.blocks) } : {}),
```

- in `new TurnController({ … })`, after `stateBlocks,`, add:

```ts
  inputBlocks: () => new Set(Object.keys(inputBlocks(harness.blocks))),
```

- in `new TaskManager({ … })`, after the `scopeExists` line, add:

```ts
  // A getter, because the harness is loaded after this object is built. Undefined without input blocks (D0).
  get inputBlocks() {
    const blocks = inputBlocks(harness.blocks);
    return Object.keys(blocks).length > 0 ? blocks : undefined;
  },
  markAnswered: async (chat, answer) => {
    const c = await validConfig();
    if (c) await new ChatLog(baseOf(c), c.engineId, chat).markAnswered(answer);
  },
```

- in `registerIpc()`, after the `hh:choose` handler, add:

```ts
  handle("hh:respond", respondHandler({ quitting: () => quitting, blocked: turnBlocked, respond: (blockId, value) => tasks.respond(blockId, value) }));
```

In `packages/ui/test/fake-client.ts`:
- add `RespondResult` to the type import;
- add after `choose`:

```ts
  /** What respond was asked, in order. */
  responded: { blockId: string; value: Record<string, unknown> }[] = [];
  /** What respond answers; default: taken, with the line "answered". */
  respondResult: RespondResult | null = null;
  /** When set, respond rejects with it. */
  respondError: Error | null = null;
  async respond(blockId: string, value: Record<string, unknown>): Promise<RespondResult> {
    this.responded.push({ blockId, value });
    if (this.respondError) throw this.respondError;
    return this.respondResult ?? { ok: true, display: "answered", value, answeredAt: "2026-10-25T10:00:00.000Z" };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/shell/test/respond-ipc.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, app build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, then `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/respond-ipc.ts packages/shell/src/main/index.ts packages/shell/src/preload/index.ts packages/ui/src/client.ts packages/ui/test/fake-client.ts packages/shell/test/respond-ipc.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): client.respond sends an answer to the open task" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

## Phase 2 — The core form, and `check` warnings (spec §10 slice 2)

### Task 10: The chat state keeps ids and answers

**Files:**
- Modify: `packages/ui/src/state.ts`
- Test: `packages/ui/test/state.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/ui/test/state.test.ts`:

```ts
describe("input blocks", () => {
  it("a live block keeps its id into the saved entry, and an answer marks it once", () => {
    let s = run([
      { type: "user", text: "go", at: "t" },
      { type: "block", name: "commit_answer", data: { question: "q" }, id: "t1:0:0" },
      { type: "block", name: "card", data: {} },
      { type: "done", ok: true },
    ]);
    expect(s.entries[1].blocks).toEqual([{ name: "commit_answer", data: { question: "q" }, id: "t1:0:0" }, { name: "card", data: {} }]);
    const answer = { blockId: "t1:0:0", value: { why: "x" }, answeredAt: "a" };
    s = reduceChat(s, { type: "answered", answer });
    expect(s.entries[1].blocks[0].input).toEqual(answer);
    expect(s.entries[1].blocks[1]).toEqual({ name: "card", data: {} });
    s = reduceChat(s, { type: "answered", answer: { ...answer, value: { why: "y" } } });
    expect(s.entries[1].blocks[0].input).toEqual(answer);
  });

  it("D0: a block without an id stays exactly as before", () => {
    const s = run([{ type: "user", text: "go", at: "t" }, { type: "block", name: "card", data: { t: 1 } }, { type: "done", ok: true }]);
    expect(s.entries[1].blocks).toEqual([{ name: "card", data: { t: 1 } }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/state.test.ts`
Expected: FAIL (the id is dropped; `answered` is not an action).

- [ ] **Step 3: Implement**

In `packages/ui/src/state.ts`:
- change the import to `import type { BlockAnswer, ChatBlock, ChatEntry, Event, LimitWindow, TurnUsage } from "./client";`;
- in `LiveTurn`, change `blocks: { name: string; data: unknown }[];` to `blocks: ChatBlock[];`;
- add to `ChatAction`:

```ts
  /** The person's answer to an input block was taken: it goes on its block (input-blocks spec §8). */
  | { type: "answered"; answer: BlockAnswer }
```

- in the `block` case, replace the last line with:

```ts
      return live
        ? { ...state, live: { ...live, blocks: [...live.blocks, { name: action.name, data: action.data, ...(action.id ? { id: action.id } : {}) }] } }
        : state;
```

- add a case before `done`:

```ts
    case "answered": {
      const id = action.answer.blockId;
      const mark = (blocks: ChatBlock[]) => blocks.map((b) => (b.id === id && !b.input ? { ...b, input: action.answer } : b));
      return {
        ...state,
        entries: state.entries.map((e) => (e.blocks.some((b) => b.id === id) ? { ...e, blocks: mark(e.blocks) } : e)),
        live: live && live.blocks.some((b) => b.id === id) ? { ...live, blocks: mark(live.blocks) } : live,
      };
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/ui/test/state.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, app build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, then `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/ui/src/state.ts packages/ui/test/state.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(ui): the chat keeps input block ids and their answers" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 11: The core `InputForm`

**Files:**
- Create: `packages/ui/src/input.ts`, `packages/ui/src/InputForm.tsx`
- Modify: `packages/i18n/src/locales/en.json`, `packages/i18n/src/locales/es.json`, `packages/ui/src/styles.css`
- Test: `packages/ui/test/input-form.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/input-form.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InputIssue, InputSpec } from "../src/client";
import { AnswerView, InputForm } from "../src/InputForm";
import { renderIn } from "./render";

afterEach(cleanup);

const L = (en: string, es = en) => ({ es, en });
const commit: InputSpec = {
  fields: [
    { name: "choice", kind: "choice", label: L("I pick", "Elegí"), optional: true, optionsFrom: "options" },
    { name: "why", kind: "longText", label: L("Why? In your own words", "¿Por qué? Con tus palabras"), optional: false, min: 1, max: 1000 },
  ],
  submitLabel: L("I commit", "Me comprometo"),
  skippable: true,
};
const data = { question: "Who ate more?", options: ["Me", "Both the same"] };

function form(over: { spec?: InputSpec; blockId?: string; disabled?: boolean; errors?: InputIssue[] } = {}) {
  const submit = vi.fn();
  const skip = vi.fn();
  const el = (
    <InputForm
      spec={over.spec ?? commit}
      data={data}
      blockId={over.blockId ?? "t1:0:0"}
      disabled={over.disabled ?? false}
      sending={false}
      errors={over.errors ?? []}
      submit={submit}
      skip={skip}
    />
  );
  return { submit, skip, el };
}

describe("InputForm", () => {
  it("draws a choice from the shown options and a labelled long text, and sends the value", async () => {
    const { submit, el } = form();
    await renderIn("en", el);
    fireEvent.click(screen.getByRole("radio", { name: "Both the same" }));
    fireEvent.change(screen.getByLabelText("Why? In your own words"), { target: { value: "two halves" } });
    fireEvent.click(screen.getByRole("button", { name: "I commit" }));
    expect(submit).toHaveBeenCalledWith({ choice: "Both the same", why: "two halves" });
  });

  it("shows each error next to its field, with a summary", async () => {
    const { el } = form({ errors: [{ path: "why", message: "Too small" }] });
    await renderIn("en", el);
    expect(screen.getByRole("alert").textContent).toContain("Check the marked fields.");
    const why = screen.getByLabelText("Why? In your own words");
    expect(why.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(why.getAttribute("aria-describedby")!)?.textContent).toBe("Too small");
  });

  it("a form-level error is shown alone", async () => {
    const { el } = form({ errors: [{ path: "", message: "This question is closed." }] });
    await renderIn("en", el);
    expect(screen.getByRole("alert").textContent).toBe("This question is closed.");
  });

  it("keeps a draft when the form is drawn again", async () => {
    const first = form({ blockId: "t1:0:5" });
    await renderIn("en", first.el);
    fireEvent.change(screen.getByLabelText("Why? In your own words"), { target: { value: "half" } });
    cleanup();
    await renderIn("en", form({ blockId: "t1:0:5" }).el);
    expect((screen.getByLabelText("Why? In your own words") as HTMLTextAreaElement).value).toBe("half");
  });

  it("skips; a disabled form sends nothing", async () => {
    const { skip, submit, el } = form({ disabled: true });
    await renderIn("es", el);
    expect((screen.getByRole("button", { name: "Me comprometo" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Saltear esta pregunta" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    const open = form();
    await renderIn("es", open.el);
    fireEvent.click(screen.getByRole("button", { name: "Saltear esta pregunta" }));
    expect(open.skip).toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("pairs: rows are added, and empty ones dropped; a field it can't draw blocks sending", async () => {
    const cards: InputSpec = {
      fields: [
        { name: "cards", kind: "pairs", label: L("Cards"), optional: false, columns: [{ name: "front", label: L("Front") }, { name: "back", label: L("Back") }] },
        { name: "sure", kind: "boolean", label: L("Sure"), optional: false },
      ],
    };
    const { submit, el } = form({ spec: cards, blockId: "t1:0:6" });
    await renderIn("en", el);
    fireEvent.change(screen.getByLabelText("Front 1"), { target: { value: "2+2" } });
    fireEvent.change(screen.getByLabelText("Back 1"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Add a row" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Sure" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(submit).toHaveBeenCalledWith({ cards: [{ front: "2+2", back: "4" }], sure: true });
    cleanup();
    const deep: InputSpec = { fields: [{ name: "deep", kind: null, label: L("Deep"), optional: false }] };
    await renderIn("en", form({ spec: deep, blockId: "t1:0:7" }).el);
    expect(screen.getByText('The app can\'t show the field "Deep" here.')).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("AnswerView", () => {
  it("reads the answer back in the window's language; a skip has its own words", async () => {
    await renderIn("es", <AnswerView spec={commit} answer={{ blockId: "t1:0:0", value: { choice: "Yo", why: "porque" }, answeredAt: "a" }} />);
    expect(screen.getByText("Tu respuesta")).toBeTruthy();
    expect(screen.getByText("Elegí")).toBeTruthy();
    expect(screen.getByText("Yo")).toBeTruthy();
    cleanup();
    await renderIn("en", <AnswerView spec={commit} answer={{ blockId: "t1:0:0", value: { skipped: true }, answeredAt: "a" }} />);
    expect(screen.getByText("You skipped this question.")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/input-form.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the helpers**

Create `packages/ui/src/input.ts`:

```ts
import type { InputField, InputSpec } from "./client";

/** The window's languages. The UI never imports the SDK at runtime, so these helpers mirror its small rules. */
export type Lang = "es" | "en";
export const langOf = (language: string): Lang => (language.startsWith("es") ? "es" : "en");

/** A choice's options: the enum's own, or the strings of the shown data's `optionsFrom` field (the SDK's `choiceOptions`). */
export function optionsOf(field: InputField, data: unknown): string[] {
  if (field.options) return field.options;
  if (!field.optionsFrom || typeof data !== "object" || data === null) return [];
  const raw = (data as Record<string, unknown>)[field.optionsFrom];
  return Array.isArray(raw) ? raw.filter((o): o is string => typeof o === "string" && o.length > 0) : [];
}

export const isSkipped = (v: Record<string, unknown>): boolean => Object.keys(v).length === 1 && v.skipped === true;

/** What the form holds while the person writes: by field name. */
export type Draft = Record<string, unknown>;
type Row = Record<string, string>;

export function emptyDraft(spec: InputSpec): Draft {
  const draft: Draft = {};
  for (const f of spec.fields) {
    if (f.kind === "boolean") draft[f.name] = false;
    else if (f.kind === "multiChoice") draft[f.name] = [];
    else if (f.kind === "pairs") draft[f.name] = [{}];
    else if (f.kind !== null) draft[f.name] = "";
  }
  return draft;
}

/** The answer the form sends: empty optional fields are left out, and pair rows with both cells empty dropped. */
export function draftValue(spec: InputSpec, draft: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of spec.fields) {
    const v = draft[f.name];
    if (f.kind === "text" || f.kind === "longText" || f.kind === "choice") {
      const s = typeof v === "string" ? v : "";
      if (s.trim() || !f.optional) out[f.name] = s;
    } else if (f.kind === "number") {
      const s = typeof v === "string" ? v.trim() : "";
      if (s) out[f.name] = Number(s);
    } else if (f.kind === "boolean") out[f.name] = v === true;
    else if (f.kind === "multiChoice") {
      const picked = Array.isArray(v) ? v : [];
      if (picked.length > 0 || !f.optional) out[f.name] = picked;
    } else if (f.kind === "pairs") {
      const cols = f.columns ?? [];
      const rows = (Array.isArray(v) ? (v as Row[]) : [])
        .filter((r) => cols.some((c) => (r[c.name] ?? "").trim()))
        .map((r) => Object.fromEntries(cols.map((c) => [c.name, r[c.name] ?? ""])));
      if (rows.length > 0 || !f.optional) out[f.name] = rows;
    }
  }
  return out;
}

/** One row per answered field, for the read-only view (the SDK's `readableAnswer`, per field). */
export function answerRows(spec: InputSpec, value: Record<string, unknown>, lang: Lang, yesNo: [string, string]): { label: string; text: string }[] {
  return spec.fields.flatMap((f) => {
    const v = value[f.name];
    if (v === undefined || v === null) return [];
    let text: string;
    if (f.kind === "boolean") text = v === true ? yesNo[0] : yesNo[1];
    else if (f.kind === "multiChoice" && Array.isArray(v)) text = v.map(String).join(", ");
    else if (f.kind === "pairs" && Array.isArray(v)) {
      text = v.map((row) => (f.columns ?? []).map((c) => String((row as Record<string, unknown> | null)?.[c.name] ?? "")).join(" → ")).join("; ");
    } else text = typeof v === "string" || typeof v === "number" ? String(v) : JSON.stringify(v);
    return text.trim() ? [{ label: f.label[lang], text }] : [];
  });
}
```

- [ ] **Step 4: Write the form**

Create `packages/ui/src/InputForm.tsx`:

```tsx
import { type ChangeEvent, type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BlockAnswer, InputField, InputIssue, InputSpec } from "./client";
import { type Draft, type Lang, answerRows, draftValue, emptyDraft, isSkipped, langOf, optionsOf } from "./input";

/** Drafts by block id: they survive the chat being drawn again (Home, Settings), not a restart (spec §11.2). */
const drafts = new Map<string, Draft>();
export const forgetDraft = (blockId: string): void => void drafts.delete(blockId);

export interface InputFormProps {
  spec: InputSpec;
  /** The block's shown data: a choice's options may come from it. */
  data: unknown;
  /** Drafts are kept by it. */
  blockId?: string;
  disabled: boolean;
  sending: boolean;
  /** From the main process: by field (`path`), "" for the whole answer. */
  errors: InputIssue[];
  submit(value: Record<string, unknown>): void;
  skip?: () => void;
}

const ofField = (e: InputIssue, name: string) => e.path === name || e.path.startsWith(`${name}.`);

/** The core form of an input block (input-blocks spec §5): a labelled control per field, errors next to each. */
export function InputForm({ spec, data, blockId, disabled, sending, errors, submit, skip }: InputFormProps) {
  const { t, i18n } = useTranslation();
  const lang = langOf(i18n.language);
  const base = useId();
  const [draft, setDraft] = useState<Draft>(() => (blockId ? drafts.get(blockId) : undefined) ?? emptyDraft(spec));
  const change = (name: string, v: unknown) =>
    setDraft((d) => {
      const next = { ...d, [name]: v };
      if (blockId) drafts.set(blockId, next);
      return next;
    });
  const general = errors.filter((e) => !spec.fields.some((f) => ofField(e, f.name)) && e.message);
  const hasFieldErrors = errors.some((e) => spec.fields.some((f) => ofField(e, f.name)));
  const unsupported = spec.fields.some((f) => f.kind === null);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!disabled && !sending && !unsupported) submit(draftValue(spec, draft));
  };
  return (
    <form className="hh-input-form" onSubmit={onSubmit} noValidate>
      {(hasFieldErrors || general.length > 0) && (
        <div className="hh-input-errors" role="alert">
          {hasFieldErrors && <p>{t("input.errorsTitle")}</p>}
          {general.map((e, i) => (
            <p key={i}>{e.message}</p>
          ))}
        </div>
      )}
      {spec.fields.map((f) => (
        <Field
          key={f.name}
          field={f}
          id={`${base}-${f.name}`}
          value={draft[f.name]}
          data={data}
          error={errors.filter((e) => ofField(e, f.name)).map((e) => e.message).join(" ")}
          disabled={disabled || sending}
          lang={lang}
          onChange={(v) => change(f.name, v)}
        />
      ))}
      <div className="hh-input-actions">
        <button type="submit" className="hh-primary" disabled={disabled || sending || unsupported}>
          {sending ? t("input.sending") : (spec.submitLabel?.[lang] ?? t("input.send"))}
        </button>
        {skip && (
          <button type="button" className="hh-link" disabled={disabled || sending} onClick={skip}>
            {t("input.skip")}
          </button>
        )}
      </div>
    </form>
  );
}

function Field({
  field,
  id,
  value,
  data,
  error,
  disabled,
  lang,
  onChange,
}: {
  field: InputField;
  id: string;
  value: unknown;
  data: unknown;
  error: string;
  disabled: boolean;
  lang: Lang;
  onChange: (v: unknown) => void;
}) {
  const { t } = useTranslation();
  const label = field.label[lang];
  const errId = `${id}-error`;
  const invalid = error ? { "aria-invalid": true as const, "aria-describedby": errId } : {};
  const errorLine = error ? (
    <p id={errId} className="hh-field-error">
      {error}
    </p>
  ) : null;
  const optional = field.optional ? <span className="hh-caption"> {t("input.optional")}</span> : null;
  if (field.kind === null) return <p className="hh-caption">{t("input.unsupported", { field: label })}</p>;
  if (field.kind === "boolean") {
    return (
      <div className="hh-field">
        <label className="hh-option">
          <input id={id} type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} {...invalid} />
          {label}
        </label>
        {errorLine}
      </div>
    );
  }
  const options = field.kind === "choice" || field.kind === "multiChoice" ? optionsOf(field, data) : [];
  if (field.kind === "choice" && options.length > 0) {
    return (
      <fieldset className="hh-field" {...(error ? { "aria-describedby": errId } : {})}>
        <legend>
          {label}
          {optional}
        </legend>
        {options.map((o) => (
          <label key={o} className="hh-option">
            <input type="radio" name={id} value={o} checked={value === o} disabled={disabled} onChange={() => onChange(o)} />
            {o}
          </label>
        ))}
        {errorLine}
      </fieldset>
    );
  }
  if (field.kind === "multiChoice") {
    const picked = Array.isArray(value) ? (value as string[]) : [];
    return (
      <fieldset className="hh-field" {...(error ? { "aria-describedby": errId } : {})}>
        <legend>
          {label}
          {optional}
        </legend>
        {options.map((o) => (
          <label key={o} className="hh-option">
            <input
              type="checkbox"
              checked={picked.includes(o)}
              disabled={disabled}
              onChange={(e) => onChange(e.target.checked ? [...picked, o] : picked.filter((p) => p !== o))}
            />
            {o}
          </label>
        ))}
        {errorLine}
      </fieldset>
    );
  }
  if (field.kind === "pairs") {
    const rows = Array.isArray(value) && value.length > 0 ? (value as Record<string, string>[]) : [{}];
    const cols = field.columns ?? [];
    return (
      <fieldset className="hh-field hh-pairs" {...(error ? { "aria-describedby": errId } : {})}>
        <legend>
          {label}
          {optional}
        </legend>
        {rows.map((row, r) => (
          <div key={r} className="hh-pair">
            {cols.map((c) => (
              <input
                key={c.name}
                type="text"
                aria-label={`${c.label[lang]} ${r + 1}`}
                value={row[c.name] ?? ""}
                disabled={disabled}
                onChange={(e) => onChange(rows.map((x, j) => (j === r ? { ...x, [c.name]: e.target.value } : x)))}
              />
            ))}
            {rows.length > 1 && (
              <button type="button" aria-label={t("input.removeRow", { n: r + 1 })} disabled={disabled} onClick={() => onChange(rows.filter((_, j) => j !== r))}>
                ×
              </button>
            )}
          </div>
        ))}
        <button type="button" disabled={disabled} onClick={() => onChange([...rows, {}])}>
          {t("input.addRow")}
        </button>
        {errorLine}
      </fieldset>
    );
  }
  // Text, long text, a number, and a choice whose shown data brought no options.
  const common = {
    id,
    value: typeof value === "string" ? value : "",
    disabled,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    ...invalid,
  };
  return (
    <div className="hh-field">
      <label htmlFor={id}>
        {label}
        {optional}
      </label>
      {field.kind === "longText" ? (
        <textarea className="hh-input-long" {...common} {...(field.max !== undefined ? { maxLength: field.max } : {})} />
      ) : field.kind === "number" ? (
        <input type="number" {...common} {...(field.min !== undefined ? { min: field.min } : {})} {...(field.max !== undefined ? { max: field.max } : {})} />
      ) : (
        <input type="text" {...common} {...(field.max !== undefined ? { maxLength: field.max } : {})} />
      )}
      {errorLine}
    </div>
  );
}

/** A sent answer, read-only. */
export function AnswerView({ spec, answer }: { spec: InputSpec; answer: BlockAnswer }) {
  const { t, i18n } = useTranslation();
  if (isSkipped(answer.value)) return <p className="hh-answer hh-caption">{t("input.skipped")}</p>;
  const rows = answerRows(spec, answer.value, langOf(i18n.language), [t("input.yes"), t("input.no")]);
  return (
    <div className="hh-answer">
      <p className="hh-caption">{t("input.answered")}</p>
      <dl>
        {rows.map((r, i) => (
          <div key={i}>
            <dt>{r.label}</dt>
            <dd>{r.text}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
```

- [ ] **Step 5: Add the strings and styles**

In `packages/i18n/src/locales/en.json`, replace

```json
    "failed": "That didn't go through. Pick an option again."
  },
```

with

```json
    "failed": "That didn't go through. Pick an option again."
  },
  "input": {
    "send": "Send",
    "sending": "Sending…",
    "skip": "Skip this question",
    "optional": "(optional)",
    "errorsTitle": "Check the marked fields.",
    "closed": "This question is closed.",
    "answered": "Your answer",
    "skipped": "You skipped this question.",
    "addRow": "Add a row",
    "removeRow": "Remove row {{n}}",
    "unsupported": "The app can't show the field \"{{field}}\" here.",
    "failed": "That didn't go through. Try again.",
    "wait": "Wait until the AI finishes, then send.",
    "stopped": "Stopped before your answer was sent. Send it again.",
    "yes": "Yes",
    "no": "No"
  },
```

In `packages/i18n/src/locales/es.json`, replace

```json
    "failed": "No se pudo. Elegí una opción de nuevo."
  },
```

with

```json
    "failed": "No se pudo. Elegí una opción de nuevo."
  },
  "input": {
    "send": "Enviar",
    "sending": "Enviando…",
    "skip": "Saltear esta pregunta",
    "optional": "(opcional)",
    "errorsTitle": "Revisá los campos marcados.",
    "closed": "Esta pregunta ya está cerrada.",
    "answered": "Tu respuesta",
    "skipped": "Salteaste esta pregunta.",
    "addRow": "Agregar una fila",
    "removeRow": "Quitar la fila {{n}}",
    "unsupported": "La app no puede mostrar el campo \"{{field}}\" acá.",
    "failed": "No se pudo enviar. Probá de nuevo.",
    "wait": "Esperá a que la IA termine y enviá.",
    "stopped": "Se frenó antes de enviar tu respuesta. Enviala de nuevo.",
    "yes": "Sí",
    "no": "No"
  },
```

Append to `packages/ui/src/styles.css`:

```css
/* Input blocks (input-blocks spec §5): the core form, and an answer once sent. */
.hh-input-block { display: flex; flex-direction: column; gap: 8px; }
.hh-input-form { display: flex; flex-direction: column; gap: 10px; }
.hh-field { display: flex; flex-direction: column; gap: 4px; border: 0; margin: 0; padding: 0; min-width: 0; }
.hh-field legend { padding: 0; margin-bottom: 4px; }
.hh-option { display: flex; align-items: center; gap: 6px; }
.hh-input-long { font: inherit; min-height: 4lh; max-height: 40vh; field-sizing: content; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--hh-line-strong); background: var(--hh-surface); color: var(--hh-ink); resize: vertical; }
.hh-pair { display: flex; gap: 6px; }
.hh-pair input { flex: 1; min-width: 0; }
.hh-field-error, .hh-input-errors { color: var(--hh-warn); }
.hh-input-form [aria-invalid="true"] { border-color: var(--hh-warn); }
.hh-input-actions { display: flex; gap: 12px; align-items: center; }
.hh-answer dl { margin: 4px 0 0; }
.hh-answer dt { font-weight: 600; color: var(--hh-slate); }
.hh-answer dd { margin: 0 0 6px; white-space: pre-wrap; }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/ui/test/input-form.test.tsx packages/i18n/test`
Expected: PASS (the i18n test checks both languages have the same keys).

- [ ] **Step 7: Typecheck, full tests, app build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, then `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/ui/src/input.ts packages/ui/src/InputForm.tsx packages/ui/src/styles.css packages/i18n/src/locales/en.json packages/i18n/src/locales/es.json packages/ui/test/input-form.test.tsx
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(ui): the core form of an input block" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 12: Input blocks in the chat

**Files:**
- Create: `packages/ui/src/InputBlock.tsx`
- Modify: `packages/ui/src/Message.tsx`, `packages/ui/src/ChatView.tsx`, `packages/ui/src/index.ts`
- Test: `packages/ui/test/input-flow.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/input-flow.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { type BlockProps, HarnessApp } from "../src";
import type { InputSpec, TaskStatus } from "../src/client";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const L = (en: string) => ({ es: en, en });
const SPEC: InputSpec = {
  fields: [
    { name: "choice", kind: "choice", label: L("I pick"), optional: true, optionsFrom: "options" },
    { name: "why", kind: "longText", label: L("Why?"), optional: false, min: 1 },
  ],
  submitLabel: L("I commit"),
};
const block = (id: string, input?: object) => ({ name: "commit_answer", data: { question: "Who ate more?", options: ["Me", "Both the same"] }, id, ...(input ? { input } : {}) });

function quizClient(opts: { inputs?: boolean; pending?: string; status?: TaskStatus; blocks?: object[] } = {}) {
  const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Quiz", engineId: "claude" });
  client.state.actions = { practice: { label: L("Practice"), cost: "light" } };
  client.state.path = ["practice"];
  if (opts.inputs !== false) client.state.inputs = { commit_answer: SPEC };
  client.chat = [
    { id: "u", role: "user", text: "Practice", blocks: [], activities: [], at: "t", action: "practice", task: "t1" },
    { id: "a", role: "assistant", text: "Let's see.", blocks: (opts.blocks ?? [block("t1:0:0")]) as never, activities: [], at: "t", task: "t1" },
  ];
  client.tasks = {
    current: { id: "t1", action: "practice", status: opts.status ?? "waiting", ...(opts.pending !== undefined ? { pendingInput: opts.pending } : { pendingInput: "t1:0:0" }) },
    actions: {},
    notes: [],
  };
  return client;
}

async function open(client: FakeClient, blocks: Record<string, ComponentType<BlockProps>> = {}) {
  render(<HarnessApp client={client} blocks={blocks} />);
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  await screen.findByText("Let's see.");
}

describe("input blocks in the chat", () => {
  it("answers the open question: the person's line shows, then the answer replaces the form", async () => {
    const client = quizClient();
    await open(client);
    expect(screen.getByRole("heading", { name: "Who ate more?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Me" }));
    fireEvent.change(screen.getByLabelText("Why?"), { target: { value: "I had two halves" } });
    fireEvent.click(screen.getByRole("button", { name: "I commit" }));
    await waitFor(() => expect(client.responded).toEqual([{ blockId: "t1:0:0", value: { choice: "Me", why: "I had two halves" } }]));
    expect(await screen.findByText("answered")).toBeTruthy();
    expect(screen.getByText("Your answer")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "I commit" })).toBeNull();
    act(() => {
      client.emit({ type: "text", delta: "Good thinking." });
      client.emit({ type: "done", ok: true });
    });
    expect(await screen.findByText("Good thinking.")).toBeTruthy();
  });

  it("a refused answer shows its errors and keeps the form", async () => {
    const client = quizClient();
    client.respondResult = { ok: false, reason: "invalid", errors: [{ path: "why", message: "Too small" }] };
    await open(client);
    fireEvent.click(screen.getByRole("button", { name: "I commit" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Check the marked fields.");
    expect(screen.getByLabelText("Why?").getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByText("answered")).toBeNull();
  });

  it("a call that fails, or a question closed meanwhile, says so", async () => {
    const client = quizClient();
    client.respondError = new Error("boom");
    await open(client);
    fireEvent.change(screen.getByLabelText("Why?"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "I commit" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That didn't go through. Try again.");
    client.respondError = null;
    client.respondResult = { ok: false, reason: "stale", errors: [{ path: "", message: "This question is closed" }] };
    fireEvent.click(screen.getByRole("button", { name: "I commit" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("This question is closed."));
  });

  it("an earlier question is closed, an answered one shows its answer, and a running task disables the form", async () => {
    const answered = { blockId: "t1:0:0", value: { why: "because" }, answeredAt: "a" };
    const client = quizClient({ blocks: [block("t1:0:0", answered), block("t1:0:1"), block("t1:0:2")], pending: "t1:0:2", status: "running" });
    await open(client);
    expect(screen.getByText("because")).toBeTruthy();
    expect(screen.getByText("This question is closed.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "I commit" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a harness component gets `input`; D0: without input specs it gets none", async () => {
    const Probe = (p: BlockProps) => <p>{p.input ? `input ${p.input.blockId} ${p.input.pending}` : "no input"}</p>;
    const client = quizClient();
    await open(client, { commit_answer: Probe });
    expect(screen.getByText("input t1:0:0 true")).toBeTruthy();
    cleanup();
    await open(quizClient({ inputs: false }), { commit_answer: Probe });
    expect(screen.getByText("no input")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/input-flow.test.tsx`
Expected: FAIL (input blocks are drawn as plain blocks, with no form).

- [ ] **Step 3: Write `InputBlock.tsx`**

Create `packages/ui/src/InputBlock.tsx`:

```tsx
import { type ComponentType, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatBlock, InputIssue } from "./client";
import { AnswerView, InputForm, forgetDraft } from "./InputForm";
import type { BlockActions, BlockProps, InputContext, InputProps } from "./Message";

/** The shown data's first text: the core view's heading (usually the question). */
export function headingOf(data: unknown): string {
  if (typeof data !== "object" || data === null) return "";
  const first = Object.values(data).find((v) => typeof v === "string" && v.trim());
  return typeof first === "string" ? first : "";
}

/**
 * One input block in the chat: it holds the last refusal's errors and the sending state, then draws the harness's
 * component (with `input`) or the core view. Only the open task's pending question may be sent, and only while
 * nothing runs.
 */
export function InputHost({
  block,
  Component,
  actions,
  inputs,
}: {
  block: ChatBlock;
  Component?: ComponentType<BlockProps>;
  actions: Omit<BlockActions, "inputs">;
  inputs: InputContext;
}) {
  const [errors, setErrors] = useState<InputIssue[]>([]);
  const [sending, setSending] = useState(false);
  const spec = inputs.specs[block.name];
  const pending = block.id !== undefined && block.id === inputs.pending && block.input === undefined;
  useEffect(() => {
    if (block.input && block.id) forgetDraft(block.id);
  }, [block.input, block.id]);
  const submit = (value: Record<string, unknown>) => {
    if (!block.id || !pending || !inputs.ready || sending) return;
    setSending(true);
    setErrors([]);
    void inputs.respond(block.id, value).then((r) => {
      setSending(false);
      if (!r.ok) setErrors(r.errors);
    });
  };
  const input: InputProps = {
    spec,
    ...(block.id ? { blockId: block.id } : {}),
    pending,
    disabled: !pending || !inputs.ready || sending,
    ...(block.input ? { answered: block.input } : {}),
    errors,
    sending,
    submit,
    ...(spec.skippable ? { skip: () => submit({ skipped: true }) } : {}),
  };
  return (
    <div className="hh-block">
      {Component ? <Component data={block.data} {...actions} input={input} /> : <CoreInputBlock data={block.data} input={input} />}
    </div>
  );
}

/** The core view of an input block: its question, then the form, the answer, or "closed". */
export function CoreInputBlock({ data, input }: { data: unknown; input: InputProps }) {
  const { t } = useTranslation();
  const heading = headingOf(data);
  return (
    <section className="hh-input-block" {...(heading ? { "aria-label": heading } : {})}>
      {heading && <h3>{heading}</h3>}
      {input.answered ? (
        <AnswerView spec={input.spec} answer={input.answered} />
      ) : input.pending ? (
        <InputForm
          spec={input.spec}
          data={data}
          {...(input.blockId ? { blockId: input.blockId } : {})}
          disabled={input.disabled}
          sending={input.sending}
          errors={input.errors}
          submit={input.submit}
          {...(input.skip ? { skip: input.skip } : {})}
        />
      ) : (
        <p className="hh-caption">{t("input.closed")}</p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Change `Message.tsx`**

In `packages/ui/src/Message.tsx`:
- replace the client import with `import type { BlockAnswer, ChatBlock, ChatEntry, ChoiceOption, InputIssue, InputSpec, RespondResult, SendOptions } from "./client";` and add `import { InputHost } from "./InputBlock";`;
- above `BlockProps`, add:

```ts
/** What a block the person answers gets (input-blocks spec §5): draw the form, or the answer once sent. */
export interface InputProps {
  spec: InputSpec;
  blockId?: string;
  /** This is the question the open task waits on, still unanswered. */
  pending: boolean;
  /** The form can't be sent now: not pending, something runs, or the answer is on its way. */
  disabled: boolean;
  answered?: BlockAnswer;
  /** Why the last send was refused: by field (`path`), "" for the whole answer. */
  errors: InputIssue[];
  sending: boolean;
  submit(value: Record<string, unknown>): void;
  /** Only for a skippable block. */
  skip?: () => void;
}

/** What the chat knows about input blocks, for every block of a message. */
export interface InputContext {
  specs: Record<string, InputSpec>;
  /** The id of the question the open task waits on. */
  pending?: string;
  /** The task waits and nothing runs: the pending question may be answered. */
  ready: boolean;
  respond(blockId: string, value: Record<string, unknown>): Promise<RespondResult>;
}
```

- add to `BlockProps`:

```ts
  /** Blocks the person answers only (their component draws the form, or uses the exported InputForm). */
  input?: InputProps;
```

- replace `export type BlockActions = Omit<BlockProps, "data">;` with:

```ts
export type BlockActions = Omit<BlockProps, "data" | "input"> & {
  /** Absent in a harness with no input block (spec D0). */
  inputs?: InputContext;
};
```

- replace `Blocks` with:

```tsx
export function Blocks({
  blocks,
  components,
  actions,
}: {
  blocks: ChatBlock[];
  components: Record<string, ComponentType<BlockProps>>;
  actions: BlockActions;
}) {
  const { inputs, ...rest } = actions;
  return (
    <>
      {blocks.map((b, i) => {
        const Component = components[b.name];
        if (inputs?.specs[b.name]) return <InputHost key={b.id ?? i} block={b} Component={Component} actions={rest} inputs={inputs} />;
        return Component ? (
          <div key={i} className="hh-block">
            <Component data={b.data} {...rest} />
          </div>
        ) : null;
      })}
    </>
  );
}
```

- [ ] **Step 5: Change `ChatView.tsx`**

In `packages/ui/src/ChatView.tsx`:
- add `type RespondResult` to the `./client` import, and `type InputContext` to the `./Message` import;
- after the `choose` function, add:

```ts
  /**
   * An answer to an input block (input-blocks spec §4). A refusal comes back with its errors for the form; a taken
   * answer marks its block, shows the person's line and the turn it starts.
   */
  const respondTo = async (blockId: string, value: Record<string, unknown>): Promise<RespondResult> => {
    if (blocked() || pending) return { ok: false, reason: "busy", errors: [{ path: "", message: t("input.wait") }] };
    busy.current = true;
    let r: RespondResult;
    try {
      r = await client.respond(blockId, value);
    } catch {
      busy.current = false;
      return { ok: false, reason: "failed", errors: [{ path: "", message: t("input.failed") }] };
    }
    if (!r.ok) {
      busy.current = false;
      if (r.reason === "stale") return { ...r, errors: [{ path: "", message: t("input.closed") }] };
      if (r.reason === "stopped") return { ...r, errors: [{ path: "", message: t("input.stopped") }] };
      return r;
    }
    stick.current = true;
    lastPick.current = null;
    setPickFailed(false);
    dispatch({ type: "answered", answer: { blockId, value: r.value, answeredAt: r.answeredAt } });
    dispatch({ type: "user", text: r.display, at: r.answeredAt });
    return r;
  };
```

- replace the `blockActions` line with:

```ts
  const inputs: InputContext | undefined = state.inputs
    ? {
        specs: state.inputs,
        ...(tasks.current?.pendingInput ? { pending: tasks.current.pendingInput } : {}),
        ready: tasks.current?.status === "waiting" && !blocked() && !pending,
        respond: respondTo,
      }
    : undefined;
  const blockActions = (active: boolean, task?: string): BlockActions => ({
    respond: sendFromHarness,
    choose: (o) => choose(o, task),
    open: openFile,
    reveal: revealFile,
    active,
    ...(inputs ? { inputs } : {}),
  });
```

In `packages/ui/src/index.ts`, replace `export type { BlockActions, BlockProps } from "./Message";` with:

```ts
export type { BlockActions, BlockProps, InputContext, InputProps } from "./Message";
export { AnswerView, InputForm, type InputFormProps } from "./InputForm";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/ui/test`
Expected: PASS (the new file and every existing UI test: without `state.inputs` the blocks are drawn as before).

- [ ] **Step 7: Typecheck, full tests, app build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, then `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/ui/src/InputBlock.tsx packages/ui/src/Message.tsx packages/ui/src/ChatView.tsx packages/ui/src/index.ts packages/ui/test/input-flow.test.tsx
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(ui): the person answers input blocks in the chat" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 13: `check` warns about input blocks it can't serve

**Files:**
- Modify: `packages/cli/src/check.ts`
- Test: `packages/cli/test/check.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/cli/test/check.test.ts`:

```ts
describe("check: input blocks", () => {
  const EXAMPLE = 'example: { title: "One idea", body: "A short explanation of why it matters." },';
  const withInput = (input: string) => (d: string) => replaceIn(d, "harness.config.ts", EXAMPLE, `input: ${input},\n  ${EXAMPLE}`);
  const inputRules = (r: CheckResult) => r.findings.filter((f) => f.rule.startsWith("input-")).map((f) => `${f.severity}:${f.rule}`);

  it("an input the core form draws gives no warning", async () => {
    expect(inputRules(await checkHarness(await fixture(withInput("z.object({ why: z.string().min(1) })"))))).toEqual([]);
  });

  it("input-hidden: a block that asks for an answer can't be hidden", async () => {
    const dir = await fixture((d) => {
      withInput("z.object({ why: z.string() })")(d);
      replaceIn(d, "harness.config.ts", "visible: true,", "visible: false,");
    });
    expect(inputRules(await checkHarness(dir))).toEqual(["warning:input-hidden"]);
  });

  it("input-form: a field the core form can't draw needs the block's own component", async () => {
    const deep = withInput("z.object({ deep: z.object({ x: z.string() }) })");
    // The template's ui/App.tsx registers `example_card`: no warning.
    expect(inputRules(await checkHarness(await fixture(deep)))).toEqual([]);
    const bare = await fixture((d) => {
      deep(d);
      replaceIn(d, "ui/App.tsx", "const blocks = { example_card: ExampleCard };", "const blocks = {};");
    });
    const r = await checkHarness(bare);
    expect(inputRules(r)).toEqual(["warning:input-form"]);
    expect(r.findings.find((f) => f.rule === "input-form")?.message).toBe(
      'Block "example_card": the core form can\'t draw "deep". Register a component for it in ui/ (blocks: { example_card: … }).',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/cli/test/check.test.ts`
Expected: FAIL (no `input-*` findings).

- [ ] **Step 3: Implement**

In `packages/cli/src/check.ts`:
- add `inputBlocks, inputFields` to the harness-sdk import;
- add `| "input-hidden" | "input-form" | "mock-input"` to `RuleId` (`mock-input` is used by Task 19);
- in `checkHarness`, after `findings.push(...(await i18nFindings(harness)));`, add `findings.push(...(await inputFindings(harness)));`;
- after `i18nFindings`, add:

```ts
/**
 * Input blocks (input-blocks spec §8): one the person can't see can't be answered; a field the core form can't draw
 * needs the block's own component. That a component is registered is guessed from the ui/ sources: the block's name
 * used as an object key (`name:`, `name,` or `name }`).
 */
async function inputFindings(h: LoadedHarness): Promise<Finding[]> {
  const inputs = Object.entries(inputBlocks(h.blocks));
  if (inputs.length === 0) return [];
  let uiDir: string | null = null;
  try {
    uiDir = resolveInHarness(h, h.ui ?? "ui");
  } catch {
    // reported by i18nFindings
  }
  const texts = uiDir ? await Promise.all((await sourceFiles(uiDir)).map((f) => fs.readFile(f, "utf8"))) : [];
  const out: Finding[] = [];
  for (const [name, block] of inputs) {
    if (!block.visible) out.push(warning("input-hidden", `Block "${name}" asks for an answer but is not visible: the person can't see it to answer.`, MANIFEST));
    const drawless = inputFields(block).filter((f) => f.kind === null).map((f) => `"${f.name}"`);
    const key = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(name)}\\s*[:,}]`);
    if (drawless.length > 0 && !texts.some((t) => key.test(t))) {
      out.push(warning("input-form", `Block "${name}": the core form can't draw ${drawless.join(", ")}. Register a component for it in ui/ (blocks: { ${name}: … }).`, MANIFEST));
    }
  }
  return out;
}
```

  (`escapeRegExp` is declared further down the file as a `const`; move its declaration above `inputFindings`, since the function only runs after module load either way, but keeping declarations before use reads better.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/cli/test/check.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/cli/src/check.ts packages/cli/test/check.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(cli): check warns about input blocks the person can't answer" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

## Phase 3 — `saveTo` and `annotate` (spec §10 slice 3)

### Task 14: `saveTo` in the SDK, and `DataStore.putMany`

**Files:**
- Modify: `packages/harness-sdk/src/block.ts`, `packages/harness-sdk/src/answer.ts`, `packages/harness-sdk/src/index.ts`, `packages/workspace/src/data.ts`, `packages/fake-agent/fixtures/input-harness/harness.config.ts`
- Test: `packages/harness-sdk/test/input.test.ts`, `packages/workspace/test/data.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/harness-sdk/test/input.test.ts`, add `answerRecords` to the import from `../src`, and append:

```ts
describe("saveTo", () => {
  const flashcards = defineBlock({
    description: "Cards.",
    visible: true,
    schema: z.object({}),
    input: z.object({ summary: z.string(), cards: z.array(z.object({ front: z.string(), back: z.string() })) }),
    skippable: true,
    saveTo: { collection: "flashcards", records: (v) => v.cards.map((c) => ({ id: c.front, ...c })) },
    example: {},
  });
  const plain = defineBlock({ description: "Plain.", visible: true, schema: z.object({}), input: z.object({ id: z.string() }), saveTo: { collection: "cards" }, example: {} });
  const harnessWith = (data: Record<string, unknown>) =>
    defineHarness({
      id: "quiz",
      name: { es: "Q", en: "Q" },
      core: "^0.1.0",
      languages: ["es", "en"],
      engines: ["claude"],
      folder: { suggested: "Documents/Q" },
      instructions: "./AGENTS.md",
      permissions: { edit: "none", exec: false, web: false },
      blocks: { plain },
      data: data as never,
      author: "t",
    });

  it("needs an input; the manifest checks its collection exists", () => {
    expect(() => defineBlock({ description: "x", visible: true, schema: z.object({}), saveTo: { collection: "c" }, example: {} })).toThrow(/need an input/);
    expect(() => harnessWith({})).toThrow(/Collection "cards" is not declared in data/);
    expect(harnessWith({ cards: { scoped: false, key: "id", schema: z.object({ id: z.string() }), agent: "read" } }).blocks.plain.saveTo?.collection).toBe("cards");
  });

  it("answerRecords: the value itself, or the block's mapping on a copy; nothing for a skip", () => {
    expect(answerRecords("plain", plain, { id: "a" })).toEqual([{ id: "a" }]);
    const value = { summary: "s", cards: [{ front: "2+2", back: "4" }] };
    expect(answerRecords("flashcards", flashcards, value)).toEqual([{ id: "2+2", front: "2+2", back: "4" }]);
    expect(answerRecords("flashcards", flashcards, { skipped: true })).toEqual([]);
    const bad = defineBlock({ ...plain, saveTo: { collection: "cards", records: () => "nope" as never } });
    expect(() => answerRecords("bad", bad, { id: "a" })).toThrow(/must return a list of records/);
  });
});
```

Append to `packages/workspace/test/data.test.ts`:

```ts
describe("DataStore.putMany", () => {
  it("writes every record in one go, and tells listeners about each", async () => {
    const store = new DataStore(tmp(), data);
    const seen: DataChange[] = [];
    store.onChange((c) => seen.push(c));
    await store.putMany("concepts", [{ id: "a", name: "A", state: "seen" }, { id: "b", name: "B", state: "seen" }], person);
    expect((await store.query("concepts", {}, person)).records.map((r) => r.id)).toEqual(["a", "b"]);
    expect(seen.map((c) => [c.op, c.key])).toEqual([["put", "a"], ["put", "b"]]);
  });

  it("refuses all of them when one is wrong; the agent can't write a read collection", async () => {
    const store = new DataStore(tmp(), data);
    await store.put("concepts", { id: "a", name: "A", state: "seen" }, person);
    await expect(store.putMany("concepts", [{ id: "b", name: "B", state: "seen" }, { id: "c", name: "C", state: "nope" }], person)).rejects.toThrow(/Not a valid "concepts" record/);
    expect((await store.query("concepts", {}, person)).total).toBe(1);
    await expect(store.putMany("cards", [{ n: 1, front: "x" }], agent)).rejects.toThrow(/may not change/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/harness-sdk/test/input.test.ts packages/workspace/test/data.test.ts`
Expected: FAIL (`saveTo` is not a Block field; `answerRecords` and `putMany` don't exist).

- [ ] **Step 3: Implement**

In `packages/harness-sdk/src/block.ts`:
- above `Block`, add:

```ts
/** Where an answer is kept (input-blocks spec §6): a declared data collection, written as the person in the task's scope. */
export interface SaveTo<I extends z.ZodObject = z.ZodObject> {
  collection: string;
  /** The records to write. Absent: the answer itself is the one record. Harness code, pure like `display`. */
  records?(value: z.infer<I>): Record<string, unknown>[];
}
```

- add to `Block`:

```ts
  /** Keep each answer in a data collection too (never a skipped one). */
  saveTo?: SaveTo<I>;
```

- in `defineBlock`, replace the "need an input" condition and message with:

```ts
    if (block.inputUi !== undefined || block.submitLabel !== undefined || block.skippable !== undefined || block.display !== undefined || block.saveTo !== undefined) {
      throw new Error("inputUi, submitLabel, skippable, display and saveTo need an input");
    }
```

In `packages/harness-sdk/src/index.ts`, at the end of the `superRefine` callback, add:

```ts
  // An answer kept in data goes to a collection the harness declares (input-blocks spec §6).
  for (const [name, b] of Object.entries(m.blocks)) {
    if (b.saveTo && !Object.hasOwn(m.data, b.saveTo.collection)) {
      ctx.addIssue({ code: "custom", path: ["blocks", name, "saveTo"], message: `Collection "${b.saveTo.collection}" is not declared in data` });
    }
  }
```

Append to `packages/harness-sdk/src/answer.ts`:

```ts
/**
 * The records an answer's `saveTo` writes (spec §6): none for a skip; the value itself without `records`; else what
 * the block's `records` returns from a copy of it. Throws when that isn't a list of objects (the answer is refused).
 */
export function answerRecords(
  name: string,
  block: Block,
  value: Record<string, unknown>,
  log: (message: string) => void = console.error,
  now?: () => number,
): Record<string, unknown>[] {
  const save = block.saveTo;
  if (!save || isSkipped(value)) return [];
  if (!save.records) return [structuredClone(value)];
  const records: unknown = timed(`saveTo.records of "${name}"`, () => save.records!.call(save, structuredClone(value) as never), log, now);
  if (!Array.isArray(records) || !records.every((r) => typeof r === "object" && r !== null && !Array.isArray(r))) {
    throw new Error(`saveTo.records of "${name}" must return a list of records`);
  }
  return records as Record<string, unknown>[];
}
```

In `packages/workspace/src/data.ts`, add after `put`:

```ts
  /**
   * Writes several records at once (an answer's `saveTo`, input-blocks spec §6). Each is checked like `put`
   * (permission, schema, key, rules) before the file is saved once: any refusal writes none. The rules see the
   * other collections as they were before the batch.
   */
  putMany(name: string, records: unknown[], ctx: DataContext): Promise<DataRecord[]> {
    return this.serialize(async () => {
      const c = this.writable(name, ctx);
      const scope = this.scopeFor(name, ctx.scope);
      if (c.single && records.length > 1) throw new DataError("invalid", `"${name}" holds one record`);
      const file = await this.loadForWrite(name, c, scope);
      let current = file.records;
      const written: { record: DataRecord; key: DataKey | undefined }[] = [];
      for (const record of records) {
        const next = this.parse(name, c, record);
        const key = c.single ? undefined : this.keyOf(c, next);
        const prev = (c.single ? current[0] : current.find((r) => r[c.key!] === key)) ?? null;
        await this.checkRules(name, c, scope, next, prev, ctx);
        current = c.single ? [next] : [...current.filter((r) => r[c.key!] !== key), next];
        written.push({ record: next, key });
      }
      if (written.length === 0) return [];
      await this.save(name, c, scope, current);
      for (const { key } of written) await this.touch(name, scope, key, true);
      for (const { key } of written) this.emit({ collection: name, scope, who: ctx.who, op: "put", ...(key !== undefined ? { key } : {}) });
      return written.map((w) => w.record);
    });
  }
```

In `packages/fake-agent/fixtures/input-harness/harness.config.ts`:
- add to `summary`, after `skippable: true,`:

```ts
  // Spec §9's flashcards: one record per card.
  saveTo: { collection: "flashcards", records: (v) => v.cards.map((c) => ({ id: c.front, front: c.front, back: c.back })) },
```

- add to `defineHarness`, after `path`:

```ts
  data: {
    flashcards: { scoped: true, key: "id", schema: z.object({ id: z.string().min(1), front: z.string().min(1), back: z.string().min(1) }), agent: "read" },
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/harness-sdk/test packages/workspace/test/data.test.ts packages/blocks/test`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/harness-sdk/src/block.ts packages/harness-sdk/src/answer.ts packages/harness-sdk/src/index.ts packages/workspace/src/data.ts packages/fake-agent/fixtures/input-harness/harness.config.ts packages/harness-sdk/test/input.test.ts packages/workspace/test/data.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(sdk): an input block may keep its answers in a data collection" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 15: The answer is saved before it is taken

**Files:**
- Modify: `packages/shell/src/main/task-manager.ts`, `packages/shell/src/main/index.ts`
- Test: `packages/shell/test/task-manager-input.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shell/test/task-manager-input.test.ts`:

```ts
describe("TaskManager.respond: saveTo", () => {
  const cards = defineBlock({
    description: "Cards.",
    visible: true,
    schema: z.object({ prompt: z.string() }),
    input: z.object({ cards: z.array(z.object({ front: z.string(), back: z.string() })) }),
    skippable: true,
    saveTo: { collection: "flashcards", records: (v) => v.cards.map((c) => ({ id: c.front, ...c })) },
    example: { prompt: "p" },
  }) as InputBlock;
  const onSummary = (): TasksFile => ({
    ...emptyTasks(),
    current: { id: "t1", action: "practice", status: "waiting", startedAt: "", turns: 1, pendingInput: { blockId: "t1:0:0", block: "summary", shownAt: NOW } },
  });

  it("writes the answer's records as the person, in the task's scope, then takes it", async () => {
    const saved: unknown[] = [];
    const t = setup({ state: onSummary(), inputs: { summary: cards }, saveAnswer: async (collection, records, scope) => void saved.push({ collection, records, scope }) });
    const { accepted, done } = t.manager.respond("t1:0:0", { cards: [{ front: "2+2", back: "4" }] });
    expect((await accepted).ok).toBe(true);
    await done;
    expect(saved).toEqual([{ collection: "flashcards", records: [{ id: "2+2", front: "2+2", back: "4" }], scope: "main" }]);
  });

  it("a refused write takes nothing: no turn, no mark, the question stays open", async () => {
    const t = setup({
      state: onSummary(),
      inputs: { summary: cards },
      saveAnswer: async () => {
        throw new Error('Not a valid "flashcards" record: back: Too small');
      },
    });
    const { accepted, done } = t.manager.respond("t1:0:0", { cards: [{ front: "2+2", back: "" }] });
    expect(await accepted).toEqual({ ok: false, reason: "refused", errors: [{ path: "", message: 'Not a valid "flashcards" record: back: Too small' }] });
    await done;
    expect(t.turns).toEqual([]);
    expect(t.marked).toEqual([]);
    expect(t.state().current?.pendingInput?.blockId).toBe("t1:0:0");
  });

  it("a skip saves nothing", async () => {
    const saved: unknown[] = [];
    const t = setup({ state: onSummary(), inputs: { summary: cards }, saveAnswer: async (...args) => void saved.push(args) });
    const { accepted, done } = t.manager.respond("t1:0:0", { skipped: true });
    expect((await accepted).ok).toBe(true);
    await done;
    expect(saved).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/shell/test/task-manager-input.test.ts`
Expected: FAIL (nothing is saved; a refused write is still taken).

- [ ] **Step 3: Implement**

In `packages/shell/src/main/task-manager.ts`:
- add `answerRecords` to the harness-sdk import;
- in `respondNow`, right after the checkpoint `if` block, add:

```ts
    // Kept before it is taken (spec §6): a refusal leaves the question open, with nothing written. The write needs
    // no commit of its own: the follow-up's "Before message" commit records it under the task's trailer.
    if (block.saveTo) {
      try {
        const records = answerRecords(pending.block, block, parsed.value);
        if (records.length > 0) {
          if (!this.d.saveAnswer) throw new Error("Answers can't be saved here");
          await this.d.saveAnswer(block.saveTo.collection, records, scopeOfTask(c));
        }
      } catch (err) {
        return refuse("refused", [{ path: "", message: err instanceof Error ? err.message : String(err) }]);
      }
    }
```

In `packages/shell/src/main/index.ts`, in `new TaskManager({ … })`, after `markAnswered`, add:

```ts
  // As the person, through the data store's checks (spec §6); the write goes out with the follow-up's commit.
  saveAnswer: async (collection, records, scope) => {
    const c = await validConfig();
    if (!c) throw new Error("The app is not set up yet");
    await dataStoreFor(baseOf(c)).putMany(collection, records, { who: "person", scope });
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/shell/test/task-manager-input.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, app build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, then `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/task-manager.ts packages/shell/src/main/index.ts packages/shell/test/task-manager-input.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): an answer is written to its collection before it is taken" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 16: The core `annotate` block

**Files:**
- Modify: `packages/harness-sdk/src/core-blocks.ts`, `packages/harness-sdk/src/index.ts`, `packages/workspace/src/instructions.ts`
- Test: `packages/harness-sdk/test/input.test.ts`, `packages/workspace/test/instructions.test.ts`, `packages/blocks/test/ui-server.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/harness-sdk/test/input.test.ts`, add `CORE_BLOCKS, allBlocks, annotateSchema` to the import from `../src`, and append:

```ts
describe("annotate", () => {
  const card = defineBlock({ description: "c", visible: true, schema: z.object({}), example: {} });
  const harness = (blocks: Record<string, ReturnType<typeof defineBlock>>) =>
    defineHarness({
      id: "quiz",
      name: { es: "Q", en: "Q" },
      core: "^0.1.0",
      languages: ["es", "en"],
      engines: ["claude"],
      folder: { suggested: "Documents/Q" },
      instructions: "./AGENTS.md",
      permissions: { edit: "none", exec: false, web: false },
      blocks,
      author: "t",
    });

  it("is offered only to a harness with an input block (spec D0)", () => {
    expect(Object.keys(allBlocks(harness({ card })))).toEqual([...Object.keys(CORE_BLOCKS), "card"]);
    expect(Object.keys(allBlocks(harness({ card, commit_answer: commit() })))).toContain("annotate");
  });

  it("its name and tool are reserved for every harness", () => {
    expect(() => harness({ annotate: card })).toThrow(/"annotate" is a core block name/);
    const sneaky = defineBlock({ description: "c", visible: true, tool: "show_annotate", schema: z.object({}), example: {} });
    expect(() => harness({ sneaky })).toThrow(/Tool "show_annotate" is already used by block "annotate"/);
  });

  it("marks quote the answer, each with a kind", () => {
    expect(annotateSchema.safeParse({ ref: "last", marks: [{ quote: "two halves", kind: "ok", comment: "Right." }] }).success).toBe(true);
    expect(annotateSchema.safeParse({ ref: "last", marks: [] }).success).toBe(false);
    expect(annotateSchema.safeParse({ ref: "last", marks: [{ quote: "x", kind: "great" }] }).success).toBe(false);
  });
});
```

Append to `describe("managedSection: input blocks", …)` in `packages/workspace/test/instructions.test.ts`:

```ts
  it("explains annotate only when the harness has it", () => {
    const line = '- To mark parts of an answer, call `show_annotate` with `ref` (the answer\'s `blockId`, or "last") and quote the person\'s exact words in each mark.';
    expect(managedSection({ language: "en", blocks: { ask } })).not.toContain("show_annotate");
    expect(managedSection({ language: "en", blocks: { ...INPUT_CORE_BLOCKS, ask } })).toContain(line);
  });
```

and add `INPUT_CORE_BLOCKS` to that file's harness-sdk import.

In `packages/blocks/test/ui-server.test.ts`, in the "tells the agent to wait" test, add after the `toContain("show_commit_answer")` line:

```ts
    expect(tools.map((t) => t.name)).toContain("show_annotate");
```

(The notes fixture's exact tool list in "exposes one tool per block" stays as it is: that is the D0 check.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/harness-sdk/test/input.test.ts packages/workspace/test/instructions.test.ts packages/blocks/test/ui-server.test.ts`
Expected: FAIL (`annotateSchema` and `INPUT_CORE_BLOCKS` don't exist).

- [ ] **Step 3: Implement**

In `packages/harness-sdk/src/core-blocks.ts`, replace everything from `export const CORE_BLOCK_NAMES` to the end with:

```ts
export const CORE_BLOCK_NAMES: readonly string[] = Object.keys(CORE_BLOCKS);

/** Marks on the person's own words (input-blocks spec §7). */
export const annotateSchema = z.object({
  /** The answered block's id, or "last": the latest answer before this block. */
  ref: z.string().min(1).max(200),
  /** The answer's field the marks are on. Default: its longest text. */
  field: z.string().min(1).max(64).optional(),
  marks: z
    .array(
      z.object({
        quote: z.string().min(1).max(500),
        kind: z.enum(["ok", "gap", "wrong", "note"]),
        comment: z.string().min(1).max(500).optional(),
      }),
    )
    .min(1)
    .max(30),
});
export type Annotation = z.infer<typeof annotateSchema>;

/** Core blocks only a harness with input blocks gets (annotate works on answers, spec §11.4). Their names are reserved for all. */
export const INPUT_CORE_BLOCKS = {
  annotate: defineBlock({
    description:
      "Marks parts of the person's answer to an input block. `ref`: that block's `blockId`, or \"last\" for the latest answer. `field`: the answer's field (default: its longest text). Each mark quotes the person's exact words and says if they are `ok`, a `gap` (something missing), `wrong`, or a `note`, with a short `comment`.",
    visible: true,
    schema: annotateSchema,
    example: { ref: "last", marks: [{ quote: "two halves", kind: "ok", comment: "Right: two halves make a whole." }] },
  }),
} satisfies Record<string, Block>;

/** Every core block name, offered or not: no harness block may take one. */
export const RESERVED_BLOCK_NAMES: readonly string[] = [...CORE_BLOCK_NAMES, ...Object.keys(INPUT_CORE_BLOCKS)];

export const hasInputBlocks = (blocks: Record<string, Block>): boolean => Object.values(blocks).some((b) => b.input !== undefined);

/** The core blocks plus the harness's own: what the agent gets as tools. `annotate` only with input blocks (spec D0). */
export function allBlocks(harness: { blocks: Record<string, Block> }): Record<string, Block> {
  return { ...CORE_BLOCKS, ...(hasInputBlocks(harness.blocks) ? INPUT_CORE_BLOCKS : {}), ...harness.blocks };
}
```

In `packages/harness-sdk/src/index.ts`:
- change the core-blocks import to `import { CORE_BLOCKS, INPUT_CORE_BLOCKS, RESERVED_BLOCK_NAMES } from "./core-blocks";`;
- in `superRefine`, replace `if (CORE_BLOCK_NAMES.includes(name))` with `if (RESERVED_BLOCK_NAMES.includes(name))`;
- replace the `tools` map line with:

```ts
  const tools = new Map<string, string>(Object.entries({ ...CORE_BLOCKS, ...INPUT_CORE_BLOCKS }).map(([name, b]) => [blockToolName(name, b), name]));
```

In `packages/workspace/src/instructions.ts`:
- add `annotateRule: string` to the `TEXT` value type;
- add to `es`: `annotateRule: 'Para marcar partes de una respuesta, llamá `show_annotate` con `ref` (el `blockId` de la respuesta, o "last") y citá las palabras exactas de la persona en cada marca.',`
- add to `en`: `annotateRule: 'To mark parts of an answer, call `show_annotate` with `ref` (the answer\'s `blockId`, or "last") and quote the person\'s exact words in each mark.',`
- replace the answers-section line with:

```ts
    if (entries.some(([, b]) => b.input)) {
      lines.push("", t.answers, "", ...t.answerRules.map((r) => `- ${r}`));
      if (Object.hasOwn(opts.blocks, "annotate")) lines.push(`- ${t.annotateRule}`);
    }
```

  (Write the two `annotateRule` strings with double quotes and escaped inner quotes if your editor prefers; the text must be exactly as above.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/harness-sdk/test packages/workspace/test/instructions.test.ts packages/blocks/test/ui-server.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/harness-sdk/src/core-blocks.ts packages/harness-sdk/src/index.ts packages/workspace/src/instructions.ts packages/harness-sdk/test/input.test.ts packages/workspace/test/instructions.test.ts packages/blocks/test/ui-server.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(sdk): the core annotate block, for harnesses with input blocks" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 17: Marks on the person's words, in the window

**Files:**
- Create: `packages/ui/src/annotate.ts`, `packages/ui/src/AnnotateBlock.tsx`
- Modify: `packages/ui/src/Message.tsx`, `packages/ui/src/ChatView.tsx`, `packages/ui/src/styles.css`, `packages/i18n/src/locales/en.json`, `packages/i18n/src/locales/es.json`
- Test: `packages/ui/test/annotate.test.tsx` (new), `packages/ui/test/styles.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/test/annotate.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AnnotateBlock } from "../src/AnnotateBlock";
import { anchorMarks, answerText, findAnswer } from "../src/annotate";
import type { ChatEntry } from "../src/client";
import { renderIn } from "./render";

afterEach(cleanup);

const answer = { blockId: "t1:0:0", value: { choice: "Me", why: "Because two halves make one whole pizza" }, answeredAt: "a" };
const noActions = { respond: () => false, choose: () => false, open: async () => false, reveal: async () => false, active: false };

describe("annotate helpers", () => {
  it("anchors each quote at its first free place; a quote not found stays loose", () => {
    const r = anchorMarks("a b a", [{ quote: "a", kind: "ok" }, { quote: "a", kind: "gap" }, { quote: "z", kind: "note" }]);
    expect(r.placed.map((p) => [p.start, p.end, p.index])).toEqual([[0, 1, 0], [4, 5, 1]]);
    expect(r.loose.map((l) => l.index)).toEqual([2]);
  });

  it("finds the answer: by id, or the latest before the annotate's own entry", () => {
    const entry = (id: string, blocks: ChatEntry["blocks"]): ChatEntry => ({ id, role: "assistant", text: "", blocks, activities: [], at: "t" });
    const later = { ...answer, blockId: "t1:1:0", value: { why: "later" } };
    const entries = [
      entry("e1", [{ name: "commit_answer", data: {}, id: "t1:0:0", input: answer }]),
      entry("e2", [{ name: "annotate", data: {} }]),
      entry("e3", [{ name: "commit_answer", data: {}, id: "t1:1:0", input: later }]),
    ];
    expect(findAnswer(entries, "e2", "last")).toEqual(answer);
    expect(findAnswer(entries, null, "last")).toEqual(later);
    expect(findAnswer(entries, null, "t1:0:0")).toEqual(answer);
    expect(findAnswer(entries, "e2", "t1:1:0")).toBeNull();
  });

  it("the text is the named field, else the answer's longest text", () => {
    expect(answerText(answer)).toBe("Because two halves make one whole pizza");
    expect(answerText(answer, "choice")).toBe("Me");
    expect(answerText(answer, "nope")).toBeNull();
  });
});

describe("AnnotateBlock", () => {
  it("marks the quotes in the person's words, each pointing to its note; a loose one is listed with its quote", async () => {
    const data = {
      ref: "last",
      marks: [
        { quote: "two halves", kind: "ok", comment: "Right." },
        { quote: "whole pizza", kind: "gap", comment: "Which pizza?" },
        { quote: "not there", kind: "note", comment: "Loose." },
      ],
    };
    await renderIn("en", <AnnotateBlock data={data} answerOf={(ref) => (ref === "last" ? answer : null)} {...noActions} />);
    expect(screen.getByRole("heading", { name: "Notes on your answer" })).toBeTruthy();
    const marks = [...document.querySelectorAll("mark")];
    expect(marks.map((m) => m.textContent)).toEqual(["two halves", "whole pizza"]);
    expect(marks[1].className).toBe("hh-mark gap");
    expect(marks[1].getAttribute("tabindex")).toBe("0");
    expect(document.getElementById(marks[1].getAttribute("aria-describedby")!)?.textContent).toBe("Missing Which pizza?");
    expect(screen.getByText("not there")).toBeTruthy();
  });

  it("says when the answer isn't in this chat, and still lists the notes", async () => {
    await renderIn("es", <AnnotateBlock data={{ ref: "t9:0:0", marks: [{ quote: "x", kind: "wrong", comment: "No." }] }} answerOf={() => null} {...noActions} />);
    expect(screen.getByText("La respuesta de estas notas no está en este chat.")).toBeTruthy();
    expect(screen.getByText("No es así")).toBeTruthy();
  });
});
```

Append to `packages/ui/test/styles.test.ts`:

```ts
describe("annotate marks", () => {
  it("the highlight under a gap keeps ink readable in light and dark", () => {
    for (const block of [light, dark]) expect(ratio(token(block, "ink"), token(block, "highlight"))).toBeGreaterThanOrEqual(7);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/ui/test/annotate.test.tsx packages/ui/test/styles.test.ts`
Expected: FAIL (modules not found; no `--hh-highlight`).

- [ ] **Step 3: Write the helpers and the block**

Create `packages/ui/src/annotate.ts`:

```ts
import type { BlockAnswer, ChatEntry } from "./client";

export type MarkKind = "ok" | "gap" | "wrong" | "note";
export interface Mark {
  quote: string;
  kind: MarkKind;
  comment?: string;
}
export interface AnnotationView {
  ref: string;
  field?: string;
  marks: Mark[];
}

const KINDS: readonly string[] = ["ok", "gap", "wrong", "note"];

/** The annotate block's data, keeping only well-formed marks (the agent wrote it; the app checked it already). */
export function readAnnotation(data: unknown): AnnotationView | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.ref !== "string" || !Array.isArray(d.marks)) return null;
  const marks = d.marks.flatMap((m): Mark[] => {
    const x = m as Record<string, unknown> | null;
    if (!x || typeof x.quote !== "string" || !x.quote || !KINDS.includes(x.kind as string)) return [];
    return [{ quote: x.quote, kind: x.kind as MarkKind, ...(typeof x.comment === "string" && x.comment ? { comment: x.comment } : {}) }];
  });
  return marks.length > 0 ? { ref: d.ref, ...(typeof d.field === "string" ? { field: d.field } : {}), marks } : null;
}

/** The answer `ref` names among the entries before `before` (all when null): by block id, or "last". */
export function findAnswer(entries: Pick<ChatEntry, "id" | "blocks">[], before: string | null, ref: string): BlockAnswer | null {
  const end = before === null ? -1 : entries.findIndex((e) => e.id === before);
  const answers = (end < 0 ? entries : entries.slice(0, end)).flatMap((e) => e.blocks.flatMap((b) => (b.input ? [b.input] : [])));
  return (ref === "last" ? answers.at(-1) : answers.find((a) => a.blockId === ref)) ?? null;
}

/** The text the marks are on: the named field, else the answer's longest text. */
export function answerText(answer: BlockAnswer, field?: string): string | null {
  const v = answer.value;
  if (field !== undefined) return typeof v[field] === "string" ? (v[field] as string) : null;
  const texts = Object.values(v).filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  return texts.length > 0 ? texts.reduce((a, b) => (b.length > a.length ? b : a)) : null;
}

export interface Placed {
  start: number;
  end: number;
  mark: Mark;
  index: number;
}

/** Each mark at the first match of its quote that overlaps no mark placed before it; the rest are loose. */
export function anchorMarks(text: string, marks: Mark[]): { placed: Placed[]; loose: { mark: Mark; index: number }[] } {
  const placed: Placed[] = [];
  const loose: { mark: Mark; index: number }[] = [];
  marks.forEach((mark, index) => {
    let at = text.indexOf(mark.quote);
    while (at >= 0 && placed.some((p) => at < p.end && at + mark.quote.length > p.start)) at = text.indexOf(mark.quote, at + 1);
    if (at >= 0) placed.push({ start: at, end: at + mark.quote.length, mark, index });
    else loose.push({ mark, index });
  });
  return { placed: placed.sort((a, b) => a.start - b.start), loose };
}
```

Create `packages/ui/src/AnnotateBlock.tsx`:

```tsx
import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { anchorMarks, answerText, readAnnotation } from "./annotate";
import type { BlockProps } from "./Message";

/**
 * The core `annotate` block (input-blocks spec §7): the person's own words with the agent's marks over them, and
 * every mark's note in a list each mark points to (aria-describedby). A mark whose quote isn't found is listed with
 * its quote; nothing is dropped.
 */
export function AnnotateBlock({ data, answerOf }: BlockProps) {
  const { t } = useTranslation();
  const id = useId();
  const note = readAnnotation(data);
  if (!note) return null;
  const answer = answerOf?.(note.ref) ?? null;
  const text = answer ? answerText(answer, note.field) : null;
  const { placed, loose } = text === null ? { placed: [], loose: note.marks.map((mark, index) => ({ mark, index })) } : anchorMarks(text, note.marks);
  const looseOnes = new Set(loose.map((l) => l.index));
  const noteId = (i: number) => `${id}-note-${i}`;
  const parts: ReactNode[] = [];
  if (text !== null) {
    let at = 0;
    for (const p of placed) {
      if (p.start > at) parts.push(text.slice(at, p.start));
      parts.push(
        <mark key={p.index} className={`hh-mark ${p.mark.kind}`} tabIndex={0} aria-describedby={noteId(p.index)} {...(p.mark.comment ? { "data-comment": p.mark.comment } : {})}>
          {text.slice(p.start, p.end)}
        </mark>,
      );
      at = p.end;
    }
    if (at < text.length) parts.push(text.slice(at));
  }
  return (
    <section className="hh-annotate" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>{t("annotate.title")}</h3>
      {text === null ? <p className="hh-caption">{t("annotate.noAnswer")}</p> : <blockquote className="hh-annotated">{parts}</blockquote>}
      <ol className="hh-annotate-notes">
        {note.marks.map((m, i) => (
          <li key={i} id={noteId(i)} className={`hh-mark-note ${m.kind}`}>
            <strong>{t(`annotate.kind.${m.kind}`)}</strong>
            {looseOnes.has(i) && (
              <>
                {" "}
                <q>{m.quote}</q>
              </>
            )}
            {m.comment && ` ${m.comment}`}
          </li>
        ))}
      </ol>
    </section>
  );
}
```

- [ ] **Step 4: Wire it into the chat**

In `packages/ui/src/Message.tsx`, add to `BlockProps`:

```ts
  /** The answer an `annotate` block is about: an answered block's id, or "last" (the latest one before this block). */
  answerOf?: (ref: string) => BlockAnswer | null;
```

In `packages/ui/src/ChatView.tsx`:
- add `import { AnnotateBlock } from "./AnnotateBlock";` and `import { findAnswer } from "./annotate";`;
- replace the `all` line with:

```ts
  // `annotate` is drawn only for a harness with input blocks, the only ones that offer it (spec D0).
  const all = useMemo(
    () => ({ ...components, choices: ChoicesBlock as ComponentType<BlockProps>, ...(state.inputs ? { annotate: AnnotateBlock } : {}) }),
    [components, state.inputs],
  );
```

- give `blockActions` a third parameter and the `answerOf` action:

```ts
  const blockActions = (active: boolean, task?: string, entryId: string | null = null): BlockActions => ({
    respond: sendFromHarness,
    choose: (o) => choose(o, task),
    open: openFile,
    reveal: revealFile,
    active,
    ...(inputs ? { inputs, answerOf: (ref: string) => findAnswer(chat.entries, entryId, ref) } : {}),
  });
```

- in the `shown.map` render, pass the entry's id: `actions={blockActions(entry === lastAssistant && !chat.live && !closing, entry.task, entry.id)}`. (The live turn keeps `blockActions(false)`: with no entry id, "last" is the latest answer in the chat.)

- [ ] **Step 5: Strings and styles**

In `packages/i18n/src/locales/en.json`, replace `  "input": {\n    "send": "Send",` with:

```json
  "annotate": {
    "title": "Notes on your answer",
    "noAnswer": "The answer these notes are about isn't in this chat.",
    "kind": { "ok": "Good", "gap": "Missing", "wrong": "Not right", "note": "Note" }
  },
  "input": {
    "send": "Send",
```

In `packages/i18n/src/locales/es.json`, replace `  "input": {\n    "send": "Enviar",` with:

```json
  "annotate": {
    "title": "Notas sobre tu respuesta",
    "noAnswer": "La respuesta de estas notas no está en este chat.",
    "kind": { "ok": "Bien", "gap": "Falta", "wrong": "No es así", "note": "Nota" }
  },
  "input": {
    "send": "Enviar",
```

In `packages/ui/src/styles.css`:
- after `  --hh-warn: #9a4a12;` add `  --hh-highlight: #fbefc4;`;
- after `    --hh-warn: #e39a5e;` add `    --hh-highlight: #4a3f1c;`;
- append:

```css
/* The core annotate block: marks over the person's own words, and the notes they point to. */
.hh-annotated { margin: 6px 0; padding: 8px 10px; border-left: 3px solid var(--hh-line-strong); white-space: pre-wrap; }
.hh-mark { position: relative; background: none; color: inherit; border-radius: 2px; text-decoration-thickness: 2px; text-underline-offset: 3px; }
.hh-mark.ok { text-decoration-line: underline; text-decoration-style: solid; text-decoration-color: var(--hh-ok); }
.hh-mark.wrong { text-decoration-line: underline; text-decoration-style: wavy; text-decoration-color: var(--hh-warn); }
.hh-mark.gap { background: var(--hh-highlight); }
.hh-mark.note { text-decoration-line: underline; text-decoration-style: dotted; text-decoration-color: var(--hh-muted); }
.hh-mark:focus-visible { outline: 2px solid var(--hh-ink); outline-offset: 1px; }
.hh-mark[data-comment]:hover::after, .hh-mark[data-comment]:focus-visible::after { content: attr(data-comment); position: absolute; left: 0; top: calc(100% + 4px); z-index: 2; width: max-content; max-width: 280px; padding: 6px 8px; border-radius: 6px; background: var(--hh-ink); color: var(--hh-on-ink); font-size: 12px; white-space: normal; }
.hh-annotate-notes { margin: 6px 0 0; padding-left: 18px; }
.hh-mark-note strong { margin-right: 4px; }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/ui/test packages/i18n/test`
Expected: PASS.

- [ ] **Step 7: Typecheck, full tests, app build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, then `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/ui/src/annotate.ts packages/ui/src/AnnotateBlock.tsx packages/ui/src/Message.tsx packages/ui/src/ChatView.tsx packages/ui/src/styles.css packages/i18n/src/locales/en.json packages/i18n/src/locales/es.json packages/ui/test/annotate.test.tsx packages/ui/test/styles.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(ui): the agent's marks over the person's words" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

## Phase 4 — Mock mode and the terminal (spec §10 slice 4)

### Task 18: Recordings carry answers, and replay follows them

**Files:**
- Modify: `packages/fake-agent/src/mock.ts`, `packages/fake-agent/src/mock-replay.ts`
- Test: `packages/fake-agent/test/mock.test.ts`, `packages/fake-agent/test/mock-replay.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/fake-agent/test/mock-replay.test.ts` (add `import { answerMessage } from "@humanharness/harness-sdk";`):

```ts
describe("replay: answers to input blocks", () => {
  const quiz = recordingSchema.parse({
    version: 1,
    action: "practice",
    match: "# Task: practice",
    turns: [
      {
        id: "t1",
        text: "Commit first.",
        blocks: [{ tool: "show_commit_answer", input: { question: "Who ate more?" } }],
        respond: [{ block: "commit_answer", value: { choice: "Me", why: "two halves" }, next: "t2" }],
        next: { "*": "t3" },
      },
      { id: "t2", text: "Right." },
      { id: "t3", text: "Let's see." },
    ],
  });
  const at = { action: "practice", turn: "t1" };
  const answering = (value: Record<string, unknown>) => answerMessage({ name: "commit_answer", blockId: "t1:0:0", value, display: "x", language: "en" });

  it("an answer equal to a recorded one, key order aside, plays its turn", () => {
    const r = replay([quiz], at, answering({ why: "two halves", choice: "Me" }), false);
    expect(r.play.text).toBe("Right.");
    expect(r.session).toEqual({ action: "practice", turn: "t2" });
  });

  it("any other answer follows *, and without * the fallback", () => {
    expect(replay([quiz], at, answering({ why: "no idea" }), false).play.text).toBe("Let's see.");
    const strict = recordingSchema.parse({ ...quiz, turns: [{ ...quiz.turns[0], next: undefined }, quiz.turns[1], quiz.turns[2]] });
    expect(replay([strict], at, answering({ why: "no idea" }), false).play.text).toBe(DEFAULT_FALLBACK);
  });
});
```

Append to `packages/fake-agent/test/mock.test.ts` (it already imports `recordingSchema`):

```ts
describe("respond", () => {
  const base = { version: 1, action: "a", match: "# A", turns: [{ id: "t1" }, { id: "t2" }] };
  it("a turn may record answers, each with the turn it leads to", () => {
    const ok = { ...base, turns: [{ id: "t1", respond: [{ block: "commit_answer", value: { why: "x" }, next: "t2" }] }, { id: "t2" }] };
    expect(recordingSchema.safeParse(ok).success).toBe(true);
    for (const bad of [{ block: "commit_answer", value: { why: "x" } }, { block: "Bad", value: {}, next: "t2" }, { block: "b", value: "x", next: "t2" }, { block: "b", value: {}, next: "t2", extra: 1 }]) {
      expect(recordingSchema.safeParse({ ...base, turns: [{ id: "t1", respond: [bad] }, { id: "t2" }] }).success).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/fake-agent/test`
Expected: FAIL (`respond` is an unknown key of a strict turn).

- [ ] **Step 3: Implement**

In `packages/fake-agent/src/mock.ts`, above `mockTurnSchema`, add:

```ts
/** A recorded answer to an input block this turn shows, and the turn it leads to (input-blocks spec §8). */
const respondSchema = z.strictObject({
  block: z.string().regex(/^[a-z][a-z0-9_]*$/),
  value: z.record(z.string(), z.unknown()),
  next: z.string().min(1),
});
```

add to `mockTurnSchema`, after `next`:

```ts
  /** Answers to this turn's input blocks: an answer equal to one of these plays its `next`; others follow `next["*"]`. */
  respond: z.array(respondSchema).optional(),
```

and after the other type exports: `export type MockRespond = z.infer<typeof respondSchema>;`.

In `packages/fake-agent/src/mock-replay.ts`:
- add `import { readAnswer } from "@humanharness/harness-sdk";`;
- above `replay`, add:

```ts
/** The same JSON, key order aside. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (typeof v === "object" && v !== null) {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  }
  return v;
}
const sameJson = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** The turn a recorded answer leads to: the prompt carries an answer (its json fence) equal to one the turn recorded. */
function answerTarget(turn: MockTurn, prompt: string): string | undefined {
  const answer = readAnswer(prompt);
  return answer ? turn.respond?.find((r) => r.block === answer.block && sameJson(r.value, answer.value))?.next : undefined;
}
```

- in `replay`, replace the `const target = …` line with:

```ts
  const answered = current ? answerTarget(current, prompt) : undefined;
  const target = answered ?? (current?.next && ((key !== undefined && Object.hasOwn(current.next, key) ? current.next[key] : undefined) ?? current.next["*"]));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/fake-agent/test`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/fake-agent/src/mock.ts packages/fake-agent/src/mock-replay.ts packages/fake-agent/test/mock.test.ts packages/fake-agent/test/mock-replay.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(fake-agent): recordings branch on the person's answers" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 19: `check` validates recorded answers (`mock-input`)

**Files:**
- Modify: `packages/cli/src/check.ts`
- Test: `packages/cli/test/check.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/cli/test/check.test.ts`:

```ts
describe("check: recorded answers", () => {
  const EXAMPLE = 'example: { title: "One idea", body: "A short explanation of why it matters." },';
  const card = { tool: "show_example_card", input: { title: "T", body: "B" } };
  const rec = (turn1: Record<string, unknown>) => ({ version: 1, action: "example", match: "# Task: example", turns: [{ id: "t1", text: "hi", ...turn1 }, { id: "t2", text: "ok" }] });
  const mockRules = async (recording: object) => {
    const dir = await fixture((d) => {
      replaceIn(d, "harness.config.ts", EXAMPLE, `input: z.object({ why: z.string().min(1) }),\n  ${EXAMPLE}`);
      fs.mkdirSync(path.join(d, "mock"));
      fs.writeFileSync(path.join(d, "mock", "example.json"), JSON.stringify(recording));
    });
    return (await checkHarness(dir)).findings.filter((f) => f.rule.startsWith("mock-")).map((f) => `${f.rule}: ${f.message}`);
  };

  it("a recorded answer to an input block the turn shows passes", async () => {
    expect(await mockRules(rec({ blocks: [card], respond: [{ block: "example_card", value: { why: "because" }, next: "t2" }] }))).toEqual([]);
  });

  it("mock-input: not an input block, not shown in that turn, or not a valid answer; mock-next: no such turn", async () => {
    expect(await mockRules(rec({ blocks: [card], respond: [{ block: "choices", value: {}, next: "t2" }] }))).toEqual([
      'mock-input: Turn "t1": respond[0] answers "choices", which is not an input block.',
    ]);
    expect(await mockRules(rec({ respond: [{ block: "example_card", value: { why: "x" }, next: "t2" }] }))).toEqual([
      'mock-input: Turn "t1": respond[0] answers "example_card", which this turn doesn\'t show.',
    ]);
    const invalid = await mockRules(rec({ blocks: [card], respond: [{ block: "example_card", value: { why: "" }, next: "t2" }] }));
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toMatch(/^mock-input: Turn "t1": respond\[0\] is not a valid answer: why /);
    expect(await mockRules(rec({ blocks: [card], respond: [{ block: "example_card", value: { why: "x" }, next: "t9" }] }))).toEqual([
      'mock-next: Turn "t1": respond[0] leads to "t9", which is not a turn.',
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/cli/test/check.test.ts`
Expected: FAIL (no `mock-input` findings).

- [ ] **Step 3: Implement**

In `packages/cli/src/check.ts`:
- add `blockToolName, parseAnswer` to the harness-sdk import;
- in `mockFindings`, inside `for (const turn of rec.turns) { … }`, after the `next` loop, add:

```ts
      // Each recorded answer answers an input block this turn shows, and is one the app would take (spec §8).
      for (const [i, r] of (turn.respond ?? []).entries()) {
        const where = `Turn "${turn.id}": respond[${i}]`;
        if (!ids.includes(r.next)) findings.push(error("mock-next", `${where} leads to "${r.next}", which is not a turn.`, file));
        const block = Object.hasOwn(h.blocks, r.block) ? h.blocks[r.block] : undefined;
        if (!block?.input) {
          findings.push(error("mock-input", `${where} answers "${r.block}", which is not an input block.`, file));
          continue;
        }
        if (!turn.blocks.some((b) => b.tool === blockToolName(r.block, block))) {
          findings.push(error("mock-input", `${where} answers "${r.block}", which this turn doesn't show.`, file));
        }
        const parsed = parseAnswer(block, r.value);
        if (!parsed.ok) {
          findings.push(error("mock-input", `${where} is not a valid answer: ${parsed.errors.map((e) => `${e.path || "(answer)"} ${e.message}`).join("; ")}.`, file));
        }
      }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/cli/test/check.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/cli/src/check.ts packages/cli/test/check.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(cli): check validates the answers a recording holds" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 20: Input blocks and marks in the terminal

**Files:**
- Create: `packages/cli/src/input-prompt.ts`
- Modify: `packages/cli/src/terminal.ts`
- Test: `packages/cli/test/input-prompt.test.ts` (new), `packages/cli/test/terminal.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/input-prompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { InputSpec } from "@humanharness/harness-sdk";
import { promptAnswer } from "../src/input-prompt";
import { memoryStream } from "./helpers";

const L = (en: string) => ({ es: en, en });
const commit: InputSpec = {
  fields: [
    { name: "choice", kind: "choice", label: L("I pick"), optional: true, optionsFrom: "options" },
    { name: "why", kind: "longText", label: L("Why?"), optional: false },
  ],
  skippable: true,
};
const asker = (answers: string[]) => {
  const asked: string[] = [];
  return { asked, ask: async (q: string) => (asked.push(q), answers.length > 0 ? answers.shift()! : null) };
};

describe("promptAnswer", () => {
  it("asks each field: a choice by its number from the shown options, then a text", async () => {
    const out = memoryStream();
    const { ask, asked } = asker(["", "2", "two halves"]);
    expect(await promptAnswer(commit, { options: ["Me", "Both the same"] }, ask, out.stream, "en")).toEqual({ choice: "Both the same", why: "two halves" });
    expect(asked).toEqual(["Skip this question? (y/N) ", "I pick (optional) (number): ", "Why?: "]);
    expect(out.text()).toContain("  1. Me\n  2. Both the same\n");
  });

  it("skips; null when the input ends", async () => {
    expect(await promptAnswer(commit, {}, asker(["y"]).ask, memoryStream().stream, "en")).toEqual({ skipped: true });
    expect(await promptAnswer(commit, {}, asker([""]).ask, memoryStream().stream, "en")).toBeNull();
  });

  it("pairs repeat until an empty line; booleans, numbers and multi-choices", async () => {
    const spec: InputSpec = {
      fields: [
        { name: "cards", kind: "pairs", label: L("Cards"), optional: false, columns: [{ name: "front", label: L("Front") }, { name: "back", label: L("Back") }] },
        { name: "sure", kind: "boolean", label: L("Sure"), optional: false },
        { name: "count", kind: "number", label: L("Count"), optional: true },
        { name: "tags", kind: "multiChoice", label: L("Tags"), optional: false, options: ["a", "b", "c"] },
      ],
    };
    const { ask } = asker(["2+2", "4", "", "y", "", "1, 3"]);
    expect(await promptAnswer(spec, {}, ask, memoryStream().stream, "en")).toEqual({ cards: [{ front: "2+2", back: "4" }], sure: true, tags: ["a", "c"] });
  });
});
```

Append to `packages/cli/test/terminal.test.ts` (add `import type { InputSpec } from "@humanharness/harness-sdk";` and reuse its `memoryStream` import from `./helpers`; add that import if the file lacks it):

```ts
describe("TerminalView: input blocks", () => {
  const spec: InputSpec = { fields: [{ name: "why", kind: "longText", label: { es: "Por qué", en: "Why" }, optional: false }], skippable: true };

  it("shows an input block's data, then what to answer, and keeps its data by id", () => {
    const out = memoryStream();
    const view = new TerminalView(out.stream, "Claude", false, { commit_answer: spec }, "es");
    view.event({ type: "block", name: "commit_answer", data: { question: "¿Quién?" }, id: "t1:0:0" });
    expect(out.text()).toContain("  [commit_answer]");
    expect(out.text()).toContain("    Answer with a: Por qué (longText) · can be skipped");
    expect(view.shown.get("t1:0:0")).toEqual({ question: "¿Quién?" });
  });

  it("shows annotate marks, one per line", () => {
    const out = memoryStream();
    const view = new TerminalView(out.stream, "Claude");
    view.event({ type: "block", name: "annotate", data: { ref: "last", marks: [{ quote: "two halves", kind: "ok", comment: "Right." }, { quote: "pizza", kind: "gap" }] } });
    expect(out.text()).toBe('  [annotate]\n    ✓ "two halves" — Right.\n    … "pizza"\n');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/cli/test/input-prompt.test.ts packages/cli/test/terminal.test.ts`
Expected: FAIL (module not found; the view takes no input specs).

- [ ] **Step 3: Implement**

Create `packages/cli/src/input-prompt.ts`:

```ts
import type { Writable } from "node:stream";
import { type InputField, type InputSpec, type Language, choiceOptions } from "@humanharness/harness-sdk";

/** Asks one question at the prompt and reads one line; null when the input ended. */
export type Ask = (question: string) => Promise<string | null>;

const YES = /^y(es)?$/i;

/**
 * `run`'s `a` (input-blocks spec §8): asks each field of the pending input block, one prompt per field. A choice is
 * picked by its number among the shown options; `pairs` repeat until an empty first cell. Null: the input ended.
 * The main process checks the answer as it does the window's.
 */
export async function promptAnswer(spec: InputSpec, data: unknown, ask: Ask, out: Writable, language: Language): Promise<Record<string, unknown> | null> {
  if (spec.skippable) {
    const skip = await ask("Skip this question? (y/N) ");
    if (skip === null) return null;
    if (YES.test(skip.trim())) return { skipped: true };
  }
  const value: Record<string, unknown> = {};
  for (const f of spec.fields) {
    const got = await askField(f, data, ask, out, language);
    if (got === null) return null;
    if ("value" in got) value[f.name] = got.value;
  }
  return value;
}

type Got = { value: unknown } | Record<string, never> | null;

async function text(label: string, f: InputField, ask: Ask): Promise<Got> {
  const a = await ask(`${label}: `);
  if (a === null) return null;
  return a.trim() || !f.optional ? { value: a } : {};
}

async function askField(f: InputField, data: unknown, ask: Ask, out: Writable, language: Language): Promise<Got> {
  const label = `${f.label[language]}${f.optional ? " (optional)" : ""}`;
  switch (f.kind) {
    case null:
      out.write(`${label}: can't be answered here.\n`);
      return {};
    case "boolean": {
      const a = await ask(`${label} (y/n): `);
      return a === null ? null : { value: YES.test(a.trim()) };
    }
    case "number": {
      const a = await ask(`${label}: `);
      if (a === null) return null;
      return a.trim() ? { value: Number(a.trim()) } : {};
    }
    case "choice":
    case "multiChoice": {
      const options = choiceOptions(f, data);
      if (options.length === 0 && f.kind === "choice") return text(label, f, ask);
      options.forEach((o, i) => out.write(`  ${i + 1}. ${o}\n`));
      const a = await ask(f.kind === "choice" ? `${label} (number): ` : `${label} (numbers, separated by commas): `);
      if (a === null) return null;
      const picks = a
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= options.length)
        .map((n) => options[n - 1]);
      if (f.kind === "choice") return picks.length > 0 ? { value: picks[0] } : a.trim() ? { value: a.trim() } : {};
      return picks.length > 0 || !f.optional ? { value: picks } : {};
    }
    case "pairs": {
      const cols = f.columns ?? [];
      const rows: Record<string, string>[] = [];
      out.write(`${label}: one row at a time; an empty line ends.\n`);
      for (let n = 1; ; n++) {
        const row: Record<string, string> = {};
        for (const [i, c] of cols.entries()) {
          const a = await ask(`  ${c.label[language]} ${n}: `);
          if (a === null) return null;
          if (i === 0 && !a.trim()) return rows.length > 0 || !f.optional ? { value: rows } : {};
          row[c.name] = a;
        }
        rows.push(row);
      }
    }
    default:
      return text(label, f, ask);
  }
}
```

In `packages/cli/src/terminal.ts`:
- replace the harness-sdk import with `import { type ChoiceOption, type InputSpec, type Language, annotateSchema, choicesSchema } from "@humanharness/harness-sdk";`;
- above the class, add `const MARK: Record<string, string> = { ok: "✓", gap: "…", wrong: "✗", note: "•" };`;
- replace the constructor with:

```ts
  /** The data each input block was shown with, by its id: `run` answers from it. */
  readonly shown = new Map<string, unknown>();

  constructor(
    private readonly out: Writable,
    private readonly engineName: string,
    private readonly color = false,
    /** The harness's input blocks, by name (input-blocks spec §8). */
    private readonly inputs: Record<string, InputSpec> = {},
    private readonly language: Language = "en",
  ) {}
```

- in `event`, replace `else if (e.type === "block") this.block(e.name, e.data);` with `else if (e.type === "block") this.block(e.name, e.data, e.id);`;
- replace `block` with:

```ts
  private block(name: string, data: unknown, id?: string): void {
    if (name === "save_note") return;
    if (name === "choices") {
      const parsed = choicesSchema.safeParse(data);
      if (!parsed.success) return;
      this.choices = parsed.data.options;
      this.newline();
      this.write("\n");
      parsed.data.options.forEach((o, i) => this.line(`  ${i + 1}. ${o.label}`));
      return;
    }
    if (name === "annotate") {
      const parsed = annotateSchema.safeParse(data);
      if (!parsed.success) return;
      this.line("  [annotate]");
      for (const m of parsed.data.marks) this.line(`    ${MARK[m.kind]} "${m.quote}"${m.comment ? ` — ${m.comment}` : ""}`);
      return;
    }
    this.line(`  [${name}]`);
    this.line(
      (JSON.stringify(data, null, 2) ?? "null")
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n"),
    );
    const spec = this.inputs[name];
    if (!spec) return;
    if (id) this.shown.set(id, data);
    const fields = spec.fields.map((f) => `${f.label[this.language]} (${f.kind ?? "not here"})`).join(", ");
    this.line(`    Answer with a: ${fields}${spec.skippable ? " · can be skipped" : ""}`);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/cli/test/input-prompt.test.ts packages/cli/test/terminal.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/cli/src/input-prompt.ts packages/cli/src/terminal.ts packages/cli/test/input-prompt.test.ts packages/cli/test/terminal.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(cli): the terminal shows input blocks and asks their fields" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 21: `run` answers with `a`, and `--record` keeps the answer

**Files:**
- Modify: `packages/cli/src/run.ts`, `packages/cli/src/record.ts`
- Test: `packages/cli/test/run.test.ts`, `packages/cli/test/record.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/cli/test/run.test.ts`:

```ts
describe("run: input blocks", () => {
  const quizDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/input-harness");
  const quizScript: ClaudeScript = {
    steps: [...claudeTextLines("Done."), result],
    turns: [
      { match: "save_note", steps: [ui("save_note", { title: "Halves", summary: ["Two halves make a whole"], decisions: [], files: [], open: [] }), result] },
      { match: "\\[answer to commit_answer\\]", steps: [...claudeTextLines("Two halves make one whole: well seen."), result] },
      { match: "# Task: practice", steps: [...claudeTextLines("First, commit."), ui("show_commit_answer", { question: "Who ate more?", options: ["Me", "Both the same"] }), result] },
    ],
  };

  it("a answers the pending question field by field; the chat keeps the answer on its block", { timeout: 60_000 }, async () => {
    const out = memoryStream();
    const folder = path.join(root, "quiz-work");
    await runTask({
      harnessDir: quizDir,
      action: "practice",
      engine: "claude",
      folder,
      input: lines("a\n2\nTwo halves are one whole\nq\n"),
      output: out.stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, quizScript) } },
    });
    const text = out.text();
    expect(text).toContain("    Answer with a: I pick (choice), Why? In your own words (longText)");
    expect(text).toContain("a to answer, or type a follow-up, or q to close the task:");
    expect(text).toContain("  1. Me\n  2. Both the same\n");
    expect(text).toContain("> I pick: Both the same\n> \n> Why? In your own words: Two halves are one whole");
    expect(text).toContain("Two halves make one whole: well seen.");
    const chat = readJsonl(path.join(folder, ".harness", "chats", "main.jsonl"));
    const shown = chat.flatMap((e) => e.blocks as { name: string; id?: string; input?: { value: unknown } }[]).find((b) => b.name === "commit_answer");
    expect(shown?.id).toMatch(/:0:0$/);
    expect(shown?.input?.value).toEqual({ choice: "Both the same", why: "Two halves are one whole" });
    expect(chat.some((e) => e.role === "user" && e.text === "I pick: Both the same\n\nWhy? In your own words: Two halves are one whole")).toBe(true);
  });
});
```

Append to `packages/cli/test/record.test.ts` (add any missing imports: `fs`, `os`, `path`, and `Recorder` from `../src/record`):

```ts
describe("Recorder: answers", () => {
  it("links the answer given to a turn's input block to the next turn, under respond", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-rec-"));
    try {
      const r = new Recorder({ folder, toolFor: (b) => `show_${b}`, matchFor: () => "# Task: practice", recordedWith: "claude" });
      await r.begin();
      r.event({ type: "block", name: "commit_answer", data: { question: "Who?" }, id: "t1:0:0" });
      await r.turnEnded({ action: "practice", task: "t1", phase: "run" });
      r.answer("commit_answer", { choice: "Me", why: "x" });
      r.event({ type: "text", delta: "Right." });
      await r.turnEnded({ action: "practice", task: "t1", phase: "run" });
      const [rec] = r.recordings();
      expect(rec.turns[0].respond).toEqual([{ block: "commit_answer", value: { choice: "Me", why: "x" }, next: "t2" }]);
      expect(rec.turns[0].next).toBeUndefined();
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/cli/test/run.test.ts packages/cli/test/record.test.ts`
Expected: FAIL (`a` is sent as a follow-up; `Recorder.answer` doesn't exist).

- [ ] **Step 3: Implement**

In `packages/cli/src/record.ts`:
- add a field to `Recorder`, after `replyKey`:

```ts
  /** What the person answered the last turn's input block with (`run`'s `a`). */
  private answerKey: { block: string; value: Record<string, unknown> } | undefined;
```

- add the method after `reply`:

```ts
  /** The person answered the last turn's input block: replay follows this answer by its JSON (`respond`). */
  answer(block: string, value: Record<string, unknown>): void {
    this.answerKey = { block, value };
    this.replyKey = undefined;
  }
```

- in `turnEnded`, in the "ignored" branch, add `this.answerKey = undefined;` next to `this.replyKey = undefined;`;
- replace

```ts
    if (meta.phase !== "close" && this.lastTurn?.action === action && this.replyKey !== undefined) {
      this.lastTurn.turn.next = { ...this.lastTurn.turn.next, [this.replyKey]: id };
    }
    this.replyKey = undefined;
```

with

```ts
    if (meta.phase !== "close" && this.lastTurn?.action === action) {
      if (this.answerKey) this.lastTurn.turn.respond = [...(this.lastTurn.turn.respond ?? []), { ...this.answerKey, next: id }];
      else if (this.replyKey !== undefined) this.lastTurn.turn.next = { ...this.lastTurn.turn.next, [this.replyKey]: id };
    }
    this.replyKey = undefined;
    this.answerKey = undefined;
```

In `packages/cli/src/run.ts`:
- add `inputBlocks, inputSpecs` and `type BlockAnswer` to the harness-sdk import, and `import { promptAnswer } from "./input-prompt";`;
- replace `promptFor` with:

```ts
const promptFor = (options: number, answerable = false) =>
  options > 0
    ? `\nPick 1–${options}, ${answerable ? "a to answer, " : ""}type a follow-up, or q to close the task: `
    : `\n${answerable ? "a to answer, or t" : "T"}ype a follow-up, or q to close the task: `;
```

- after `const language: Language = …` (and its check), add:

```ts
  // The harness's input blocks (input-blocks spec §8). Without any, the run is exactly as before (D0).
  const inputs = inputBlocks(harness.blocks);
  const hasInputs = Object.keys(inputs).length > 0;
  const specs = inputSpecs(harness.blocks);
```

- replace `const view = new TerminalView(out, engine.name, (out as { isTTY?: boolean }).isTTY === true);` with:

```ts
  const view = new TerminalView(out, engine.name, (out as { isTTY?: boolean }).isTTY === true, specs, language);
```

- in `new TurnController({ … })`, after `stateBlocks: () => stateBlocks,`, add:

```ts
    ...(hasInputs ? { inputBlocks: () => new Set(Object.keys(inputs)) } : {}),
```

- in `new TaskManager({ … })`, after `scopeExists`, add:

```ts
    ...(hasInputs
      ? {
          inputBlocks: inputs,
          markAnswered: async (chat: string, answer: BlockAnswer) => void (await new ChatLog(folder, engine.id, chat).markAnswered(answer)),
          saveAnswer: async (collection: string, records: Record<string, unknown>[], scope: string) =>
            void (await dataStore.putMany(collection, records, { who: "person", scope })),
        }
      : {}),
```

- in the prompt loop:
  - after `let closeStopped = false;`, add:

```ts
    /** One line for a field's prompt: Ctrl-C isn't raced here, and the end of the input reads as null. */
    const ask = async (question: string): Promise<string | null> => {
      out.write(question);
      const next = await (pending ??= typed.next());
      pending = undefined;
      return next.done ? null : next.value;
    };
```

  - replace `out.write(promptFor(options.length));` with `out.write(promptFor(options.length, current.pendingInput !== undefined));`;
  - after `closeStopped = false;`, add:

```ts
        const asked = current.pendingInput;
        if (line === "a" && asked && Object.hasOwn(specs, asked.block)) {
          const value = await promptAnswer(specs[asked.block], view.shown.get(asked.blockId), ask, out, language);
          if (!value) continue;
          const { accepted, done } = tasks.respond(asked.blockId, value);
          const r = await accepted;
          if (!r.ok) {
            const why = r.errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)).join("; ");
            out.write(`\nNot sent (${r.reason})${why ? `: ${why}` : ""}\n`);
            await done;
            continue;
          }
          recorder?.answer(asked.block, r.value);
          out.write(`\n> ${r.display.replaceAll("\n", "\n> ")}\n\n`);
          await done;
          continue;
        }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/cli/test`
Expected: PASS (the new tests and every existing `run` test: the template has no input block, so its prompts are unchanged).

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/cli/src/run.ts packages/cli/src/record.ts packages/cli/test/run.test.ts packages/cli/test/record.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(cli): run answers input blocks, and --record keeps the answers" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

## Phase 5 — Docs and the end-to-end test

### Task 22: Architecture docs and the authoring guide

**Files:**
- Modify: `docs/architecture/blocks.md`, `docs/architecture/mock-mode.md`, `docs/architecture/authoring.md`, `docs/architecture/history.md`, `packages/cli/guide/new-harness.md`

- [ ] **Step 1: `blocks.md`**

Append to `docs/architecture/blocks.md`:

```markdown

## Input blocks

A block may declare `input`, a `z.object` of what the person answers (spec `2026-10-25-input-blocks-design.md`). Everything below applies only to a harness with at least one; any other harness behaves exactly as before (no ids, no `pendingInput`, no `annotate`, no answers section, the same tool answers).

- **Contract** (`packages/harness-sdk/src/block.ts`): `input`, `inputUi` (per field: `kind` text/longText/choice, `label`, `optionsFrom`, `columns`), `submitLabel`, `skippable`, `display(value, language)` and `saveTo: { collection, records? }`. `defineBlock` checks the input is a `z.object` and that the answer settings come with one; the manifest checks `saveTo.collection` is declared in `data`.
- **Field kinds** (`input.ts`): a string ≤ 200 characters is one line, longer or unbounded a growing textarea; a `choice` field with shown `options` (or `inputUi.optionsFrom`) and an enum are choices; numbers, booleans, arrays of enums (multi-choice) and arrays of two-string objects (`pairs`) are read from zod. Anything else is `kind: null`: the core form can't draw it and `check` warns (`input-form`) unless `ui/` registers a component. The window gets the result as plain data, `AppState.inputs`.
- **Showing it.** The ui server answers an input block's call with "Done: the person can see it and will answer; wait for their answer.". `TurnController` gives each input block of a task's run turn the id `<task>:<turn>:<index>` (on the `block` event, so the window, the chat log and the task manager share it). `TaskManager` records the last one as `tasks.json` → `current.pendingInput` while the turn runs; a newer one replaces it, closing the task drops it.
- **Answering** (`client.respond(blockId, value)` → `hh:respond` → `TaskManager.respond`). One operation: the block must be the waiting task's pending one (`stale`), the value must pass `input` (`invalid`, with zod's issues by field), a due checkpoint runs first (`stopped` if cancelled), then `saveTo` writes through `DataStore.putMany` as the person in the task's scope (`refused`). Then the question closes, the chat log entry gets `input: { blockId, value, answeredAt }` (`ChatLog.markAnswered`), the window gets `{ ok: true, display }`, and the answer goes to the agent as a follow-up: `[answer to <block>]`, the readable line, then a ```json fence with `block`, `blockId` and `value`. Refusals are values, not thrown errors, so their field errors survive Electron's IPC.
- **The readable line**: the block's `display` (harness code, run in the main process on a copy, logged when slower than 100 ms), else one `<label>: <value>` paragraph per answered field.
- **The window**: `Blocks` wraps input blocks in `InputHost` (`packages/ui/src/InputBlock.tsx`), which draws the harness's component with an `input` prop, or the core view: the question (the shown data's first text), then `InputForm` while pending, the answer once sent, or "This question is closed.". Drafts live in memory by block id until sent.
- **`annotate`** (core, offered only with input blocks): marks quotes of an answered block's text (`ref`: its id or `"last"`) as `ok`, `gap`, `wrong` or `note`. `AnnotateBlock` places each quote at its first free match and lists every mark's note; one not found is listed with its quote.

Known gaps: zod's validation messages are in English; `display` and `saveTo.records` can't be stopped, only logged when slow; `putMany`'s rules see the other collections as they were before the batch; a draft is lost on restart.
```

- [ ] **Step 2: `mock-mode.md`**

In `docs/architecture/mock-mode.md`:
- after the bullet that starts with `` - `next`: reply to next turn id.``, add:

```markdown
- `respond`: recorded answers to an input block the turn shows, each `{ "block", "value", "next" }`. An answer whose JSON equals `value` (key order aside) plays `next`; any other answer follows the turn's `next["*"]`, then the fallback.
```

- in "How replay walks it", after the **A reply.** bullet, add:

```markdown
- **An answer.** A prompt that ends with an answer's ```json fence (`readAnswer` in `packages/harness-sdk/src/answer.ts`) is matched against the turn's `respond` first.
```

- in "Recording", after the **Replies.** bullet, add:

```markdown
- **Answers.** `a` at `run`'s prompt answers the pending input block field by field; the answer is recorded under the turn's `respond`, leading to the next turn.
```

- in "check rules", after the `mock-choice` bullet, add:

```markdown
- `mock-input`: each `respond` answers an input block the turn shows (by its tool) with a value the block's `input` accepts; a `respond[].next` that is no turn is `mock-next`.
```

- [ ] **Step 3: `authoring.md`**

In `docs/architecture/authoring.md`:
- in the Errors line, replace `` `mock-next`, `mock-choice`. `` with `` `mock-next`, `mock-choice`, `mock-input`. ``;
- in the Warnings line, replace `` `permissions-wide`, `open-questions`. `` with `` `permissions-wide`, `open-questions`, and for input blocks `input-hidden` (an input block that isn't visible) and `input-form` (a field the core form can't draw, with no component in `ui/`). ``

- [ ] **Step 4: `history.md`**

In `docs/architecture/history.md`, insert before the line `### The History panel`:

```markdown
An answer's `saveTo` write has no commit of its own: it lands in the follow-up turn's "Before message" commit, which carries the task's trailer, so undoing the task undoes it too.

```

- [ ] **Step 5: The guide**

In `packages/cli/guide/new-harness.md`, in "Phase 2 — Decisions", after the bullet that starts with `- When they need to see structured information`, add:

```markdown
- When the person must answer something the task depends on (commit to an answer, explain in their own words, sum up, make flashcards), give the block an `input`: a `z.object` of the answer, checked by the app. Name each field's label in `inputUi`, a `submitLabel` if "Send" doesn't fit, and `skippable: true` when skipping is fine. The core draws the form; register a component only for fields it can't draw (`check` says which). Add `saveTo: { collection }` to keep each answer in `data`, and the core `annotate` block lets the agent mark the person's words. Ask what the agent does with the answer, and write it in the brief.
```

- [ ] **Step 6: Tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green (`packages/cli/test/guide.test.ts` still finds every phase).

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add docs/architecture/blocks.md docs/architecture/mock-mode.md docs/architecture/authoring.md docs/architecture/history.md packages/cli/guide/new-harness.md
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "docs: input blocks in the architecture docs and the authoring guide" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 23: End to end on the `quiz` fixture, and D0 on the demo

**Files:**
- Create: `packages/fake-agent/fixtures/input-harness/ui/App.tsx`, `packages/e2e/tests/input-scripts.ts`, `packages/e2e/tests/input.spec.ts`
- Modify: `packages/fake-agent/package.json`, `packages/e2e/tests/flow.spec.ts`

- [ ] **Step 1: The fixture's screen**

The build aliases `@harness/ui` to `<harness>/ui/App.tsx`, so the fixture needs one. In `packages/fake-agent/package.json`, add:

```json
  "devDependencies": {
    "@humanharness/ui": "workspace:*",
    "@types/react": "^19.3.0",
    "react": "^19.3.0"
  }
```

Run: `corepack pnpm install`
Expected: the lockfile gains the three links for `@humanharness/fake-agent`; nothing else changes.

Create `packages/fake-agent/fixtures/input-harness/ui/App.tsx`:

```tsx
import { type HarnessClient, HarnessApp } from "@humanharness/ui";

// Only core blocks and the core form: what a harness gets without writing any UI.
export default function App({ client }: { client: HarnessClient }) {
  return <HarnessApp client={client} />;
}
```

- [ ] **Step 2: The script**

Create `packages/e2e/tests/input-scripts.ts`:

```ts
import { type ClaudeScript, claudeTextLines } from "@humanharness/fake-agent";

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

/** The quiz: a question to commit to, then marks on the person's own words. */
export const quizScript: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    {
      match: "save_note",
      steps: [ui("save_note", { title: "Mitades", summary: ["Dos mitades son un entero"], decisions: [], files: [], open: [] }), ...claudeTextLines("Guardé el resumen."), result],
    },
    {
      match: "\\[respuesta a commit_answer\\]",
      steps: [
        ...claudeTextLines("Bien pensado."),
        ui("show_annotate", { ref: "last", marks: [{ quote: "dos mitades", kind: "ok", comment: "Exacto." }] }),
        result,
      ],
    },
    {
      match: "# Task: practice",
      steps: [...claudeTextLines("Primero, comprometete."), ui("show_commit_answer", { question: "¿Quién comió más?", options: ["Yo", "Mi amiga", "Las dos igual"] }), result],
    },
  ],
};
```

- [ ] **Step 3: The test**

Create `packages/e2e/tests/input.spec.ts`:

```ts
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { closeAndClean, launch, makeSandbox, readJsonl, shellDir } from "./helpers";
import { quizScript } from "./input-scripts";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/input-harness");

test("the person answers an input block; the agent gets the line and the JSON, and marks the answer", async () => {
  // A full app build of the fixture before the app starts.
  test.setTimeout(300_000);
  const s = makeSandbox("input");
  const outDir = path.join(shellDir, "out", "input");
  // electron-vite directly: `humanharness dev --build` would first run `check`, which a test fixture has no HARNESS.md for.
  const env = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: outDir };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });

  const { app, page } = await launch(s, { claude: quizScript }, path.join(outDir, "main", "index.js"));
  try {
    await page.getByRole("button", { name: "Iniciar Quiz" }).click();
    await page.getByRole("button", { name: /Practicar/ }).first().click();
    const question = page.getByRole("region", { name: "¿Quién comió más?" });
    await expect(question).toBeVisible();

    // Nothing written: the app refuses it, and the error sits next to the field.
    await question.getByRole("button", { name: "Me comprometo" }).click();
    await expect(question.getByRole("alert")).toContainText("Revisá los campos marcados.");
    await expect(question.getByLabel("¿Por qué? Con tus palabras")).toHaveAttribute("aria-invalid", "true");

    await question.getByRole("radio", { name: "Las dos igual" }).check();
    await question.getByLabel("¿Por qué? Con tus palabras").fill("Porque dos mitades son un entero");
    await question.getByRole("button", { name: "Me comprometo" }).click();

    const line = "Elegí: Las dos igual\n\n¿Por qué? Con tus palabras: Porque dos mitades son un entero";
    await expect(page.getByRole("main").getByText("Bien pensado.")).toBeVisible();
    await expect(question.getByText("Tu respuesta")).toBeVisible();
    await expect(page.locator("mark.hh-mark.ok")).toHaveText("dos mitades");

    // The agent got the readable line and the exact JSON.
    const prompts = readJsonl<{ prompt: string }>(s.claudePrompts).map((p) => p.prompt);
    const answer = prompts.find((p) => p.startsWith("[respuesta a commit_answer]"));
    expect(answer).toContain(line);
    const json = JSON.parse(/```json\n(.+)\n```$/.exec(answer!)![1]);
    expect(json).toMatchObject({ block: "commit_answer", value: { choice: "Las dos igual", why: "Porque dos mitades son un entero" } });
    expect(json.blockId).toMatch(/^[0-9a-f-]+:0:0$/);

    // tasks.json: nothing pending any more. The chat log: the answer on its block, and the person's line.
    const tasks = JSON.parse(fs.readFileSync(path.join(s.folder, ".harness", "tasks.json"), "utf8"));
    expect(tasks.current.pendingInput).toBeUndefined();
    const chat = readJsonl<{ role: string; text: string; blocks: { name: string; id?: string; input?: { value: unknown } }[] }>(path.join(s.folder, ".harness", "chats", "main.jsonl"));
    const shown = chat.flatMap((e) => e.blocks).find((b) => b.name === "commit_answer");
    expect(shown).toMatchObject({ id: json.blockId, input: { value: json.value } });
    expect(chat.some((e) => e.role === "user" && e.text === line)).toBe(true);

    // AGENTS.md explains answers.
    expect(fs.readFileSync(path.join(s.folder, "AGENTS.md"), "utf8")).toContain("### Respuestas de bloques de entrada");
  } finally {
    await closeAndClean(app, s);
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: D0 on the demo**

In `packages/e2e/tests/flow.spec.ts`, in the test that walks the manifest topic and checks `tasks.json` and the chat log after its first answer (the one that already asserts the plan-1 D2 state), add after those assertions:

```ts
    // Input blocks D0: the demo declares none, so nothing of them shows anywhere.
    const agents = fs.readFileSync(path.join(s.folder, "AGENTS.md"), "utf8");
    expect(agents).not.toContain("### Respuestas de bloques de entrada");
    expect(agents).not.toContain("show_annotate");
    expect(JSON.parse(fs.readFileSync(path.join(s.folder, ".harness", "tasks.json"), "utf8")).current).not.toHaveProperty("pendingInput");
    const chatLines = readJsonl<{ blocks: Record<string, unknown>[] }>(path.join(s.folder, ".harness", "chats", "main.jsonl"));
    expect(chatLines.flatMap((e) => e.blocks).every((b) => !("id" in b) && !("input" in b))).toBe(true);
```

(Use the test's own sandbox variable, `s` in that file's other tests, and add the `fs`, `path` and `readJsonl` imports it lacks.)

- [ ] **Step 5: Run the e2e suite**

Run: `corepack pnpm app:build` then `corepack pnpm e2e`
Expected: every spec passes, the new `input.spec.ts` included.

- [ ] **Step 6: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green (the fixture's `ui/App.tsx` typechecks with the new dev dependencies).

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/fake-agent/package.json pnpm-lock.yaml packages/fake-agent/fixtures/input-harness/ui/App.tsx packages/e2e/tests/input-scripts.ts packages/e2e/tests/input.spec.ts packages/e2e/tests/flow.spec.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "test(e2e): an input block answered end to end; D0 on the demo" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

## Spec coverage

| Spec | What it asks | Task(s) |
|---|---|---|
| §2 D1 | `input` next to `schema`; a block without it is as today | 1, 2; D0 tests in 4, 5, 6, 7, 21, 23 |
| §2 D2 | One way back: `client.respond(blockId, value)` | 8, 9 |
| §2 D3 | Main validates before anything else | 3 (`parseAnswer`), 8 |
| §2 D4 | Next turn's message: readable line + exact JSON | 3 (`answerMessage`), 8 |
| §2 D5 | One pending input per task; a newer one replaces it | 7, 12 (older ones read as closed) |
| §2 D6 | Core form for simple schemas; harness components otherwise | 11, 12, 13 (`input-form`) |
| §2 D7 | Optional `saveTo`, same checks, before the turn | 14, 15 |
| §3 | `input`, `inputUi`, `submitLabel`, `skippable`, `display` | 1, 2, 3 |
| §4 | Round trip: tool answer says wait, ids, `pendingInput`, respond, chat line, `AGENTS.md` paragraph | 4, 5, 6, 7, 8, 9, 12 |
| §5 | Field kinds, errors by field, accessibility | 2, 11 |
| §6 | Typed follow-up keeps it; drafts until submit, not across restart; read-only once sent; skip; choices next to an input; restart shows it again; checkpoint before submit | 7, 8, 11, 12 |
| §7 | `annotate`: quotes, kinds, anchoring, loose marks, hover/focus + listed comments, value untouched | 16, 17, 20 (terminal) |
| §8 | Chat log `input`, history covers `saveTo`, mock `respond` + branches, `--record`, `mock-input`, terminal prompts | 6, 15, 18, 19, 20, 21, 22 |
| §9 | Flashcards (`longText` + `pairs` + `saveTo` + `annotate`), "Me comprometo" (`choice` + `longText`) | Fixture in 4/14; e2e in 23 |
| §10 | Slices 1–4 | Phases 1–4 |
| §11 | One pending input; no draft persistence; `display` pure, time-boxed in main; `annotate` only on answered input blocks | 7, 11, 3, 16/17 |

## Self-review

- **Placeholders:** none. Every code step shows its code; the two "add the imports it lacks" notes (Tasks 20, 21, 23) name the exact imports.
- **Type consistency, checked across tasks:**
  - `TaskDeps.saveAnswer(collection, records, scope)` (Task 7) matches its test setup (Task 7), its use in `respondNow` (Task 15), and both wirings (Task 15 main, Task 21 `run`).
  - `TaskDeps.markAnswered(chat, answer)` (Task 7) matches Task 9 (main) and Task 21 (`run`).
  - `respond(blockId, value) → { accepted, done }` and `RespondResult` (Task 3) are used the same way in Tasks 8, 9, 12 and 21.
  - `BlockProps.answerOf` (Task 17) sits next to `BlockProps.input` (Task 12); `BlockActions` omits only `data` and `input`, so `answerOf` passes through it.
  - `TerminalView(out, engineName, color, inputs, language)` (Task 20) matches its construction in `run.ts` (Task 21); `view.shown` is filled only for input blocks with an id.
  - `Recorder.answer(block, value)` (Task 21) writes `respond` entries in the shape `respondSchema` accepts (Task 18), which `check` validates (Task 19).
  - `defineBlock`'s "need an input" message is updated once, in Task 14, to include `saveTo`; Task 1's test matches `/need an input/`, so it keeps passing.
- **D0:** every surface a harness without input blocks touches keeps an exact-output test: the tool answer text (Task 4), `AGENTS.md` (Task 5), chat entries without `id` (Task 6), `tasks.json` without `pendingInput` (Task 7), the tool list without `show_annotate` (Task 16), `run`'s prompts (Task 21: the existing tests), and the demo end to end (Task 23).
- **Spec deviations,** each listed under Decisions: `annotate` only for harnesses with input blocks (the spec says every harness); `annotate.field` defaults to the longest text; `comment` is optional; mock `respond` is a list with `next` per answer.
- **Compliance:** no task reads `~/.claude`, `~/.codex`, `~/.gemini` or any account, token or credential file. `display` and `saveTo.records` get a `structuredClone` of the value and no fs/network/process handle (Tasks 3, 14).




