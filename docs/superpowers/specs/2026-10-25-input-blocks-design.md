# Input blocks — design

Status: draft, 2026-10-25, waiting for Marco's review. Not in the roadmap yet. Comes from the student-vs-core gap analysis (`docs/discovery/2026-10-25-student-vs-core.md`, gap #11). Builds on `2026-10-25-scopes-and-data-design.md` (optional `saveTo`).

## 1. Why

Today blocks go one way: the agent shows something, the person reads it.

- **`choices` is the only way back.** A pick reaches the main process through `client.choose(option, task)` (`packages/ui/src/client.ts`). `TaskManager.chooseNow` (`packages/shell/src/main/task-manager.ts`) then turns it into a follow-up, a new action or the next step of the path.
- **Anything richer goes through the chat.** A harness component can call `client.send(text)`, but only with plain text. The agent then has to parse that text back into structure.

Harnesses need the person to answer in a shape:

- **Student.**
  - The Socratic "Me comprometo": an answer, then "why, in your own words".
  - At the close, the learner writes the summary and the flashcards, and the AI corrects them.
- **Dev.** A decision wizard: one decision at a time, with an option and a reason.

Each harness would build its own form and its own text protocol. This spec makes the round trip a core contract.

## 2. Decisions (proposed)

- **D1. A block may declare an `input` schema**, next to the `schema` it already has. The agent fills `schema` (what to show); the person fills `input` (what comes back). A block without `input` behaves as today.
- **D2. One way back for all input blocks:** `client.respond(blockId, value)`. `choices` stays as it is (it moves the task along, not just answers), but its handling is the model for this.
- **D3. The main process validates the value** against `input` before anything else. A value that does not match never reaches the agent.
- **D4. The value goes to the agent as the next turn's message.** The message holds a short readable line, which the chat shows, plus the exact JSON in a fenced block.
- **D5. At most one input waits at a time** per task. A newer input block replaces the older one, which becomes read-only.
- **D6. A core form renders simple schemas.** A harness that needs a special look registers its own component, as it does for any visible block.
- **D7. Optional `saveTo`.** The value can also be written to a data collection (scopes-and-data spec), with the same checks, before the turn runs.

## 3. Declaring an input block

```ts
blocks: {
  commit_answer: defineBlock({
    description: "Asks the learner to commit to an answer and explain why, before you reveal anything.",
    visible: true,
    schema: z.object({ question: z.string(), options: z.array(z.string()).max(4).optional() }),
    input: z.object({
      choice: z.string().optional(),
      why: z.string().min(1).max(1000),
    }),
    inputUi: { why: { kind: "longText", label: { es: "¿Por qué? Con tus palabras", en: "Why? In your own words" } } },
    submitLabel: { es: "Me comprometo", en: "I commit" },
    example: { question: "¿Quién comió más?", options: ["Yo", "Las dos igual", "Mi amiga"] },
  }),
}
```

- **`input`.** A zod object. It is the contract of the value, checked in main (D3).
- **`inputUi`** (optional) tells the core form how to draw each field (§5). Without it, the form guesses from the zod type.
- **`submitLabel`** (optional). The button's text. The default is "Enviar" / "Send".
- **`defineBlock`** checks `example` against `schema` as today. It also requires `input` to be a `z.object`.
- **`check`** (plan 4a) flags a `visible: false` block that declares `input`, since the person cannot answer a hidden block.

The agent's tool is unchanged (`show_<name>` with `schema` as its arguments). The tool's answer becomes "Done: the person can see it and will answer; wait for their answer." This replaces "Done: the person can see it now.", so the agent ends its turn instead of guessing.

## 4. The round trip

1. The agent calls `show_commit_answer`. The bridge forwards it, and the runtime emits a `block` event as today. The main process gives it an id (`blockId` = task id + turn + index) and records it in `tasks.json` as the task's `pendingInput` (`{ blockId, block, shownAt }`).
2. The window draws the block with its form, enabled only while the task is `waiting` and this block is the pending one.
3. The person submits. `client.respond(blockId, value)` goes over IPC to `TaskManager.respond`, which runs inside `op()` like `choose`:
   - **Stale.** The block must be the task's pending input. Otherwise the error is "That answer belongs to an earlier question", like `chooseNow`'s "earlier task".
   - **Validate.** `value` is parsed with the block's `input`. When it fails, the zod issues go back to the window, which shows them next to the fields. No turn runs.
   - **Save.** If `saveTo` is set, the value is written through the data store with `who: "person"`. The checks of the data spec apply (schema, rules). A refusal is shown like a validation error, and no turn runs.
   - **Clear.** `pendingInput` is cleared, and `askNow(message, display)` runs the next turn.
4. **The message:**

   ````
   [respuesta a commit_answer]
   Elegí: Las dos igual. Por qué: Porque 2 pedazos chiquitos son como uno grande.

   ```json
   {"block":"commit_answer","blockId":"…","value":{"choice":"Las dos igual","why":"Porque 2 pedazos chiquitos son como uno grande"}}
   ```
   ````

   - **The readable line** (`display`) is what the chat shows as the person's message. It is built by the core from `inputUi` labels and the values. A harness may give `display(value, language)` in the block to word it better.
   - **The JSON** is what the agent relies on. The managed section of `AGENTS.md` explains this format once, for all input blocks.

## 5. The core form

`packages/ui` gets `InputForm`, which renders these field kinds:

| `kind` | Inferred from | Renders |
|---|---|---|
| `text` | `z.string()` with max ≤ 200 | one-line input |
| `longText` | `z.string()` with no max, or max > 200 | textarea, which grows |
| `number` | `z.number()` | number input, with min and max from zod |
| `choice` | `z.enum([...])`, or a string with `options` in the shown data | radio group |
| `multiChoice` | `z.array(z.enum([...]))` | checkbox group |
| `pairs` | `z.array(z.object({ a: z.string(), b: z.string() }))` | a list of two-field rows with add and remove (flashcards: question / answer) |
| `boolean` | `z.boolean()` | checkbox |

- **Nested objects** beyond `pairs` are not rendered by the core form. A block that needs them must register its own component. `check` warns when a block's `input` has a shape the core form cannot draw and the harness registers no component for it.
- **Accessibility.** Every field has a real `<label>`, and errors are announced through `aria-describedby`. Submit is a `<button>`.
- **A harness component** gets `{ data, input: { pending, submit(value), errors } }`. `submit` is `client.respond` bound to the block. So a custom look never needs its own protocol.

## 6. Edge cases

- **The person types in the chat instead.** The message goes as an ordinary follow-up, and the pending input stays open. The agent sees the plain text and decides: answer it, or remind the person of the question. The managed instructions tell the agent that a pending input may still be answered later. A new `show_*` input block from the agent replaces the pending one (D5).
- **Edit before sending.** The form is local state until submit. Nothing is sent per keystroke. The draft survives switching tabs inside the window, but not a restart.
- **Edit after sending.** Not in the first version. The answered block is read-only and shows the value sent. To change an answer, the person writes a follow-up, or the agent shows the block again.
- **Cancel.** A "Saltar" link is offered only if the block declares `skippable: true`. It sends `{ skipped: true }` with the readable line "(saltado)", and skips validation.
- **Choices next to an input.** An answer may end with both an input block and `choices`. Picking a choice that starts another action or the next path step closes the task as today, and the pending input is dropped. A follow-up choice keeps it open.
- **Task closes or the app restarts.** `pendingInput` lives in `tasks.json`, so a restart while waiting shows the form again, active. Closing the task clears it.
- **Checkpoint.** A checkpoint never runs while a value is being submitted: `respond` is one `op()` and checks `needsCheckpoint` first, like `askNow`.

## 7. Annotating the person's text

Pattern: the person wrote something, and the AI marks parts of it ("correcto", "falta", "revisá"). Examples: the student's summary and flashcards, Feynman explanations.

- **The core block `annotate`.** It is visible and available to every harness, like `choices`.
  ```ts
  annotate: {
    ref: string,                     // the blockId of an answered input, or "last"
    field?: string,                  // which field of that value (default: the first string field)
    marks: { quote: string, kind: "ok" | "gap" | "wrong" | "note", comment: string }[],
  }
  ```
- **Anchoring.** Each mark is anchored by `quote`, an exact substring of the person's text, not by offsets: models are bad at offsets. The window finds the first unused match. A mark whose quote is not found is shown as a plain comment under the text, never dropped.
- **Rendering.** The core renders the person's text again with highlights by kind:
  - `ok`: underline in the mastery green;
  - `gap`: soft yellow background;
  - `wrong`: wavy underline;
  - `note`: dotted underline.

  Each highlight shows its comment on focus or hover, and the comment is also listed below the text for screen readers.
- **The original value is never changed.** The marks live in the chat log next to the block that holds the text.

## 8. Chat log, history, mock mode

- **Chat log** (`.harness/chats/…jsonl`). The block entry gets `input: { blockId, value, answeredAt }` once answered. The person's turn is logged as usual with the readable line. The JSON stays only in the engine's message.
- **History.** Nothing new: the turn commits as any turn. A `saveTo` write is part of that turn's commit, so undo covers it.
- **Mock mode (3e).**
  - A recording's turn can carry `respond: { block, value }` in place of a typed message, and a branch per answer, like the per-choice `next`.
  - `run --record` writes the value the developer gave.
  - `check` validates every recorded `value` against the block's `input` (new error `mock-input`).
  - In the terminal (`humanharness run`), an input block is drawn as numbered prompts, one per field, with the `pairs` kind as repeated prompts until an empty line.

## 9. What this closes from the gap analysis

| Gap | How |
|---|---|
| #11 The learner writes the summary and flashcards, the AI corrects them | An input block with `longText` + `pairs`, `saveTo` the flashcards collection, then `annotate` |
| Socratic "Me comprometo" | An input block with `choice` + `longText` |
| Dev decision wizard | An input block per decision (`choice` + reason), `saveTo` a decisions collection |

## 10. Delivery slices

1. **Contract.**
   - `input`, `inputUi`, `submitLabel` and `skippable` in `Block`.
   - `pendingInput` in `tasks.json`.
   - `client.respond`, validation and the turn message.
   - The `AGENTS.md` paragraph.
2. **Core form.** `InputForm` with the field kinds, errors and accessibility, plus the `check` warnings.
3. **`saveTo` and `annotate`.** After the data store slice of scopes-and-data.
4. **Mock and terminal.** Recordings with `respond`, the `mock-input` check, and terminal prompts.

## 11. Open questions

1. **Several open inputs.** Should one answer be allowed to show several input blocks at once? Example: three flashcards as three blocks. The proposal is one block with `pairs` instead, to keep "one pending input" simple.
2. **Partial drafts across restarts.** Should they be saved in `tasks.json`? The student's summary can be long. The proposal is not in v1.
3. **`display` function in the manifest.** It is harness code running in main, like the data spec's `rules`. It must be pure and time-boxed.
4. **Annotating without an input block.** Should `annotate` also work on text the person typed in the chat? A `ref` to a chat message id would do it. It is left out until a harness needs it.
