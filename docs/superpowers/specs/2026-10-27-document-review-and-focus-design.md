# Document review and focus mode — design

Status: draft, 2026-10-27, written after a brainstorming session with Marco, who approved every decision below that day. Waiting for his review of this file. Not in the roadmap yet.

This is spec B from the dev-vs-core gap analysis (`docs/discovery/2026-10-26-dev-vs-core.md`, candidates C2 and C3). It builds on the document reader (`2026-10-27-document-reader-design.md`, 10th in the core order), which leaves comments, approval and focus mode to this spec (its §8). It adds one key to task phases (`2026-10-25-task-phases-design.md`). With parallel tasks (`2026-10-27-parallel-tasks-and-jobs-design.md`), its writes follow that spec's attribution; without them, nothing here depends on it.

## 1. Why

The reader shows an agent's document well, but the person can only read it:

- **The agent cannot ask about a passage.** A question in the chat loses where it belongs, and the answer has to be written back into the document by another turn.
- **The person cannot comment on a passage.** Feedback goes in the chat as free text ("in section 3, the second option…").
- **Nothing records "I approved this".** The harness cannot tell a draft from an agreed document, or notice that an agreed one changed later.

The dev harness reviews a spec, a plan and a review for every ticket (discovery, mockup v3 rounds 2 and 5). Writer drafts, teacher course plans, thinker essays and student summaries are the same loop: the agent drafts, the person answers and comments, the agent revises, the person approves. Every harness would rebuild it.

## 2. Decisions (approved by Marco)

- **D1. Options carry their own text.** When the agent asks about a passage, it writes, for each option, the text that replaces that passage. Answering, or changing the answer, swaps the passage at once, with no turn and no tokens. A custom answer ("Other") goes to the agent.
- **D2. The person's comments go in a batch.** The person comments on several passages, then sends them together: one turn, one review round.
- **D3. Blocking questions can be overridden with a reason.** "Approve anyway" asks for one line, which is stored with the approval and sent to the agent.
- **D4. An approval belongs to a version.** If the file changes after approval (by the agent or the person), it goes back to review: the change is shown, and the document must be approved again.
- **D5. Focus mode uses the reader's sans/serif preference** (sans by default). This replaces the dev-only rule "focus is always sans".
- **D6. The review lives outside the `.md`,** so the document stays clean and renders the same on GitHub.

## 3. The review record

```
.harness/reviews/<document path>.json
```

- It is tracked by the history, like `.harness/notes/` and `.harness/data/`: undo and "what changed in this task" cover it.
- `<document path>` is relative to the person's folder, with `/` kept as folders (`.harness/reviews/tickets/SHOP-142/spec.md.json`).

```ts
type Review = {
  path: string;
  task: string | null;              // the task that created the document (its card's task); null when unknown
  comments: Comment[];
  approvals: { blob: string; at: string; reason?: string }[];  // blob: git blob id of the approved text
};

type Comment = {
  id: string;                        // c1, c2…
  author: "agent" | "person";
  kind: "question" | "comment";
  anchor: { quote: string; heading: string | null; occurrence: number };
  text: string;                      // the question, or the comment
  options?: { label: string; text: string }[];   // questions only, 2–5
  blocking?: boolean;                // questions only
  answer?: { option: number } | { other: string };
  original?: string;                 // the passage before the first answer, so changing the answer can swap back
  state: "draft" | "open" | "answered" | "sent" | "resolved" | "lost";
  replies: { author: "agent" | "person"; text: string; at: string }[];
  at: string;
};
```

- **Anchor.** `quote` is the passage's exact text. `heading` is the slug of the nearest heading above it (from the reader's heading ids). `occurrence` says which match under that heading it is (0-based). When the quote is no longer found, the comment becomes `lost` (§7).
- **Approved** means that the current file's blob equals the last approval's `blob`. **Stale** means there is an approval, but the blob differs.
- Writes to the record go through main, one at a time per document.

## 4. The agent's tools

Three core tools on the `ui` MCP server, next to `choices` and `save_note`. They are reserved names (`allBlocks`).

| Tool | Input | What it does |
|---|---|---|
| `ask_in_document` | `{ path, quote, heading?, question, options: [{ label, text }], blocking? }` | Adds an `open` question anchored on `quote`. `quote` must occur in the file. The first match is used, or the first match under `heading` (a heading slug) when it is given. |
| `reply_to_comment` | `{ path, id, reply, resolve }` | Adds a reply. `resolve: true` marks it `resolved`. A reply that asks something back keeps it `open`. |
| `read_review` | `{ path }` | Returns the comments that are not `resolved`, their answers, and whether the document is approved or stale. |

- Errors go back to the agent as tool errors, and it can retry:
  - "quote not found in spec.md";
  - "spec.md is outside your folder";
  - "options: 2 to 5";
  - "unknown comment c9".
- Paths follow the reader's rule (`hh:readDocument`): inside the person's folder only.
- **Jobs cannot use them.** Like `choices` and input blocks (parallel-tasks spec §8), they answer: "A background job cannot ask the person; end with job_result."
- **The base writing guide** (reader spec §4.1) gains three lines: ask about a passage with `ask_in_document`, giving the full replacement text for each option; mark a question blocking only when the document cannot be approved without it; after a review round, answer every comment with `reply_to_comment`.

## 5. The flow

### 5.1 Answering a question

1. The person picks an option.
2. Main writes the file, replacing the anchored passage with the option's `text`, and stores `original` on the first answer. It then commits `Answer: <path> · <question, cut to 60>`, with the trailers of the review's task (or of the open task when the review has none).
3. **Changing the answer** replaces the current option's text with the new one. Picking "no answer" puts `original` back.
4. **"Other"** stores `{ other }` and keeps the passage as it is. It travels in the next batch, where the agent writes the passage.

Answers stay changeable until the document is approved.

### 5.2 Commenting

- The person selects text in the reader and picks "Comentar". The comment is saved as a `draft`, anchored on the selection.
- Drafts can be edited or deleted until they are sent.

### 5.3 Sending a batch

"Enviar comentarios (N)" counts drafts plus "Other" answers. It sends one turn:

```
Review round for tickets/SHOP-142/spec.md.
Comments:
- c4 on "the size filter keeps…" (## Scope): "Esto no, tiene que ser por talle y color."
Custom answers:
- c2 "¿Se guarda el filtro?": "Solo en la sesión, no en la cuenta."
Edit the document, then answer each one with reply_to_comment.
```

- **Where it goes:**
  - to the review's task when it is open;
  - otherwise to a new task, **Revisar `<title>`**, in the document's scope, with a core brief (`REVIEW_PROMPT`: the path, the batch, and "read_review for the rest"), at the `standard` tier.
- The sent items become `sent`. The agent's `reply_to_comment` moves them on.
- With parallel tasks, the batch obeys the cap and the queue like any message.

### 5.4 Approving

- **"Aprobar"** appends `{ blob, at }`, commits `Approved: <path>`, and locks the answers.
- **With blocking questions open,** the button reads "Aprobar igual, con motivo". The reason is required and stored with the approval.
- **The document's task is told.** If it is open, it gets a quiet message: "The person approved tickets/SHOP-142/spec.md" plus ", with reason: …" when there is one. When its current phase declares `approve`, the phase advances (§5.5).
- **When the file changes later,** the document is stale:
  - the answers unlock;
  - the reader shows "Aprobado · cambió después · Ver qué cambió", a line diff between the approved blob and the current text (the full diff view is C4's spec);
  - approving again appends a new approval.

### 5.5 Phases

Task phases gain one optional key:

```ts
phases: [
  { id: "spec", brief: "phases/spec.md", approve: "tickets/*/spec.md" },
  { id: "plan", brief: "phases/plan.md" },
]
```

When a document matching `approve` (a glob relative to the folder) is approved during that phase, the task moves to the next phase, as if `client.setPhase` had been called. A stale document does not move the phase back.

### 5.6 Harness client

```ts
client.documents.review(path): ReviewSummary        // approved | stale | draft, open questions, blocking count, drafts
client.documents.onChange(cb): Unsubscribe           // any review record or approval change
client.documents.approve(path, reason?): Promise<void>
client.documents.focus(path): void                   // §6.2
client.focus.onChange(cb): Unsubscribe               // §6.2
```

The dev harness uses `onChange` for its explorer marks (● waiting for you, A/M from its own git view).

## 6. UI

### 6.1 In the reader

- **Marks in the text:**
  - open questions in amber, with ■ when blocking;
  - the person's comments in blue;
  - resolved ones faint.

  A mark is drawn on the anchored passage by matching the quote in the rendered text.
- **A "Comentarios" column** to the right of the document, one card per comment in text order. A question card shows its options as buttons, the chosen one marked, and "Podés cambiar la respuesta hasta aprobar". Replies show under the card. Below about 900 px the column moves under the document.
- **The footer bar:**
  - "Enviar comentarios (N)" and "Aprobar" / "Aprobar · 1 bloqueante abierta" / "Aprobar igual, con motivo";
  - when approved: "Aprobado · hace 5 min";
  - when stale: "Aprobado · cambió después · Ver qué cambió".
- **Chat cards** (reader spec §5.1) gain a status chip: "2 preguntas", "Aprobado", "Cambió después".
- **Reading only.** A document with no review record shows no comment column until the first comment.

### 6.2 Focus mode

- **Entering and leaving.** The "Foco" button in the reader, or `client.documents.focus(path)`, enters it; Esc or "Salir del foco" leaves it.
- **The layout.** It goes further than the reader's full screen:
  - one centered column, in the reader's sans/serif and size preferences (D5);
  - comments hidden behind a "Comentarios · N" toggle, with small markers in the margin of the text; a marker opens its card;
  - the approve bar at the end of the document, not fixed.
- **What it pauses until the person leaves:**
  - the core's notices: tasks that start waiting, job results, out-of-quota, Sidekick heads-ups;
  - these pile up, and on leaving, one summary line says what happened: "Mientras leías: 2 tareas esperan por vos, 1 job terminó".
- **What it does not pause.** Turns keep running. The Dock badge keeps counting.
- **The harness pauses its own.** `client.focus.onChange` tells the harness UI, so it can pause its own interruptions (dev: its terminal's output and its sidekick places).

## 7. Edge cases

| Case | Behavior |
|---|---|
| The anchored passage changed and the quote is gone | The comment becomes `lost`. Its card says "El pasaje cambió", it is read-only for the person, and its answer travels in the next batch |
| The same quote appears twice under one heading | `occurrence` picks it. If an edit shifts the matches, the nearest match to the old position is taken; if none, `lost` |
| The document is deleted or moved | The record stays in `.harness/reviews/`; the card is struck through (reader spec §6) |
| Two parallel tasks edit a reviewed document | Parallel-tasks spec §5.3 conflict notice. The review keeps its task |
| Undo of a task | It also restores `.harness/reviews/…`, so that task's answers, comments and approvals are undone with the text |
| `ask_in_document` in a job | Refused (§4) |
| A question with an option whose `text` equals the quote | Allowed: "keep it as it is" is a valid option |
| The person edits the file by hand after approval | Stale, like any change (D4) |

## 8. Tests

- **Unit:**
  - option swap, and changing the answer there and back, including "no answer" back to `original`;
  - anchors: a repeated quote, a lost and then shifted quote;
  - building the batch, and where it goes (open task, or a new review task);
  - approval: blocking with a reason, stale after a blob change, approving again;
  - phase advance on `approve`, and no move back when stale;
  - the three tools' errors;
  - the manifest check of `approve` globs.
- **Fake agent:** a recording with a spec carrying two questions (one blocking), a batch, and the agent's replies.
- **E2E (mock mode):**
  - answer a question and change the answer;
  - comment and send a batch;
  - approve anyway with a reason;
  - edit after approval and see "cambió después";
  - focus mode with paused notices and the summary on leaving.

## 9. What this closes from the gap analysis

| Gap | How |
|---|---|
| C2 Reviewable document | The review record, the three tools, answers by option, batches, approval by version (§3–§5) |
| C3 Focus mode | §6.2 |
| Dev: spec questions whose answers change until approval | D1 + §5.1 |
| Dev: import notes for the person to confirm | Questions with options on `project.md` / `conventions.md` |
| Dev: the flow stops on spec approval | `approve` on a phase (§5.5) |

Dev-only and left out: review findings with "send to dev / the spec is wrong / discard" (harness UI over `read_review` and its own data), AC coverage.

## 10. Delivery slices

1. **Record and tools.** `.harness/reviews/`, history tracking, the three tools, the writing-guide lines.
2. **Answers and approval.** Option swap, approval and stale state, the `Approved` message, `client.documents`.
3. **Reader UI.** Marks, the comment column, drafts and the batch, the footer bar, chat card chips.
4. **Phases.** The `approve` key and its advance.
5. **Focus mode.** Layout, paused notices with the summary, `client.focus`.
6. **Mock and terminal.** The fake-agent recording. `humanharness run` prints "Review: 2 questions open" under a document's line.

## 11. Open questions

1. **Comments on a diagram or a table cell.** A quote inside a Mermaid block or a table is matched on its source text. Should marks inside a drawn diagram be shown? Proposal: no; the card says "en el diagrama de § Flujo".
2. **Who may resolve a person's comment.** Today the agent resolves it with `reply_to_comment`. Should the person confirm? Proposal: the person can reopen any resolved comment, and that is enough.
3. **Review task tier.** `standard` by default. A harness may want `deep` for specs. Proposal: `documents.kinds.<kind>.reviewTier`, next to the kind's template.
