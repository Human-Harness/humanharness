# Document reviews and focus mode

Spec: `docs/superpowers/specs/2026-10-27-document-review-and-focus-design.md` ("§" and "D" below). Plan: `docs/superpowers/plans/2026-10-28-document-review-and-focus.md`. It builds on the reader (`documents.md`) and adds one key to task phases (`phases.md`).

## What a review is

- **Questions.** The agent asks about a passage of a document it wrote, with 2 to 5 options. Each option carries the text that replaces the passage, so picking one swaps the passage at once: no turn, no tokens (D1). "Other" is a custom answer that goes to the agent.
- **Comments.** The person selects text in the reader and comments on it. Comments are drafts until the person sends them together as one review round: one turn (D2).
- **Rounds.** The agent edits the document for each item and answers each one with `reply_to_comment`.
- **Approval.** The person approves a version of the document. A later change makes the approval stale, and the reader shows what changed.

Reviews exist only for a harness whose agent may edit the folder (`permissions.edit: "folder"`). Every such harness gets the tools, three guide lines and the reader's controls, even if it never uses them (plan Q1). See D0 below.

The pure logic lives in `packages/harness-sdk/src/review.ts` (subpath `@humanharness/harness-sdk/review`, no Node imports, no zod). It covers sections, anchors, the projection, the swap, status and summary, the batch message, the line diff and the `approve` glob. The window, main, the runtime and the CLI all use it. The zod schema of the record is in `review-schema.ts`, used only by main and the CLI. As with the reader, every scan of document text is a hand-written loop or `indexOf`, never a regex that can backtrack, and the timing tests run on about 50,000 characters.

## The record

`.harness/reviews/<document path>.json` (`packages/workspace/src/reviews.ts`), one file per document:

- `path`: the document, relative to the folder, in its canonical spelling (`canonicalDocumentPath`: the real path, with the case the disk has). The record, its lock and `path` all use this one key. A record that names another spelling is refused, and the schema refuses a path with an empty, `.` or `..` part or one that isn't Markdown.
- `task`: the task that was open when the record was made (by the agent's first question or the person's first comment), or `null`. `scope` (optional): that task's scope. A new "Review <title>" task opens in this scope.
- `comments`: up to 500. Each one has:
  - `id`: `c1`, `c2`, … (one more than the highest). Two comments with one id make the record broken.
  - `author` (`agent` or `person`) and `kind` (`question` or `comment`).
  - `anchor`, `text`, `replies` (up to 200) and `at`.
  - A question also has `options` (`{ label, text }`), `blocking`, `answer` (`{ option }` or `{ other }`) and `original` (the passage before the first swap). `unapplied: true` marks an answer the app could not swap in.
- `approvals`: up to 200 `{ blob, at, reason? }`. `blob` is git's blob id of the approved bytes (`blobId`: sha1 of `blob <size>\0<bytes>`).

Comment states:

| State | Meaning |
|---|---|
| `draft` | The person's comment, not sent yet. The agent's tools neither see nor answer drafts. |
| `open` | A question with no answer, or an item the agent asked something back about. |
| `answered` | A question with an answer. |
| `sent` | In a review round the agent has not answered yet. |
| `resolved` | The agent resolved it (`reply_to_comment` with `resolve: true`). |
| `lost` | The passage is no longer in the document. |

`lost` is worked out from the current text whenever the record is shown or used. Main writes it only together with another change to the record.

Writes:

- Each record is written atomically (a temp file, then rename).
- Every record is checked against `reviewSchema` before it is saved. A record over 5 MB (`MAX_RECORD_BYTES`) is refused as "full".
- There is one writer at a time per document (`ReviewLocks`), shared by the agent's tools and the person's actions in the app.
- `ReviewLocks` serializes within one process only. The app and `humanharness run` on the same folder don't share locks.
- The history tracks `.harness/reviews/` (see `history.md`).

A record that fails the schema is "broken" (for example after a hand edit):

- The tools refuse with "the review of spec.md can't be read".
- The reader shows the document without review controls, with a note naming the file to fix or delete.

The person's documents are read and written only through `readOwnDocument` and `writeOwnDocument`. These accept only the person's folder (never a reference folder, never `.harness/`), only `.md`, and never a link or a hard-linked file. A write also needs the bytes on disk to still equal what was read under the lock, and a document is at most 10 MB (`MAX_REVIEW_DOCUMENT_BYTES`).

## Anchors

An anchor is `{ quote, heading, occurrence }`:

- `quote`: the passage's exact source text.
- `heading`: the slug of the section it is in (null before the first heading).
- `occurrence`: its rank among the matches of `quote` in that section.

**Sections.** A section runs from an id-bearing heading to the next one: top-level ATX `#`–`####` or setext, outside code fences, after the front-matter. Slugs come from `createSlugger` over the heading's plain text, so they match the reader's ids. Matches are counted without overlap.

**Finding an anchor again** (`locate`), in this order:

1. The `occurrence`-th match in its section.
2. Else the last match in the section.
3. Else the first match anywhere.
4. Else the anchor is `lost`.

A swap uses the strict form (only inside its section), so it never replaces the wrong passage. After every swap, `anchor.quote` becomes the passage's new text.

**The agent's anchor.** `ask_in_document` takes the first match of `quote`, or the first under `heading` when one is given (`anchorAt`).

**The person's anchor.** A comment starts from a rendered selection (`anchorForSelection`):

1. `project` turns the source into roughly what the reader shows: markup and block markers left out, every run of whitespace one space, with a map back to source offsets.
2. The selection is found in that text, preferring the section of the heading above the selection.
3. The match is mapped back to an exact source substring.

The window sends the selection's own text (`Selection.toString()`), which puts line breaks between blocks; a range's text would join two paragraphs with no space. A selection past the end of the text is clamped to it.

**Marks.**

- `markOccurrence` projects the quote the same way and gives which rendered match to mark. `review-marks.ts` finds that match in the reader's rendered body.
- Marks are drawn with the CSS Custom Highlight API (`CSS.highlights`, styled by `::highlight()` rules in `styles.css`). They don't rewrite the DOM and need no CSP change.
- The highlights are `hh-review-question`, `hh-review-comment`, `hh-review-done` and `hh-review-active` (the hovered or focused card).
- A quote inside a ```` ```mermaid ```` fence never gets a mark. Its card says "In the diagram of § <heading>" (`diagramOf`, §11.1).

## The agent's tools

`ask_in_document`, `reply_to_comment` and `read_review` are served by the `ui` MCP server (`packages/blocks/src/ui-server.ts`), next to the blocks:

- `ask_in_document({ path, quote, heading?, question, options, blocking? })`:
  - adds an `open` question and returns `{ id }`;
  - `options`: 2 to 5, each `{ label, text }` (label up to 120 characters);
  - `question`: up to 500 characters;
  - `heading`: a slug, with one leading `#` allowed.
- `reply_to_comment({ path, id, reply, resolve })`:
  - adds a reply;
  - `resolve: true` resolves the item, `false` keeps it `open` (the agent asks something back).
- `read_review({ path })`: the comments and questions not resolved and not drafts, with their answers and their state (`lost` worked out from the text), and the document's status (`none`, `draft`, `approved`, `stale`).

The `ui` bridge only answers "ok", so these tools use a request/answer channel of their own: an `Rpc` like the `data` server's. Its socket and token reach the server as `HH_REVIEW_RPC` and `HH_REVIEW_RPC_TOKEN`. Each request goes to `runReviewRequest` (`packages/workspace/src/review-requests.ts`).

The runtime opens the channel only when it is given a `review` handler and the agent may edit the folder. Its `reviewHandler` passes the agent only a `ReviewRefused` message. Any other failure (a file system error that names paths) becomes "The app could not do that. Nothing was saved; do not retry in a loop." A timeout says "The app did not answer; check with read_review before asking again".

The refusals the agent reads (§4):

- "spec.md is outside your folder"
- "spec.md is not a Markdown (.md) document"
- "spec.md does not exist"
- "spec.md is too large to review"
- "quote not found in spec.md"
- "no heading #scope in spec.md"
- "unknown comment c9"
- "the review of spec.md can't be read"
- "spec.md has too many comments"
- the input checks ("options: 2 to 5", …)

With the tools, `AGENTS.md`'s "Writing for the reader" part gets three more lines (`WritingGuide.reviewRules` in `packages/workspace/src/instructions.ts`):

- use `ask_in_document`, with the full replacement text for each option;
- mark a question `blocking` only when the document can't be approved without its answer;
- after a review round, answer every comment with `reply_to_comment`.

## The person's side

`ReviewService` (`packages/shell/src/main/reviews.ts`) does the person's side. The window reaches it through the `hh:review*` channels (`review-ipc.ts`), and every answer is data (`{ ok: false, reason }`, never a thrown error). Its locks are the same ones the runtime's handler uses (`reviews.agent(base, request)`).

**Answers (§5.1).**

- An option swaps the passage for its text. The first answer keeps the passage as `original`, and "No answer" puts it back. "Other" keeps the passage and goes in the next round.
- **The swap guard.** When the passage is no longer where its anchor says (strictly in its section), nothing is swapped. The answer is marked `unapplied` and travels in the next round. The card says so.
- **Waiting for the turn.** An answer waits until no turn runs (`TaskManager.whenSettled`); meanwhile the card says "Waiting for the turn to end". Then it writes the document and the record and commits `Answer: <path> · <question>` with the open task's trailer.
- While the current version is approved, answers are locked.

**Comments (§5.2).**

- Selecting text in the reader offers "Comment". The comment is saved as a draft at once (no commit; it goes with the next commit).
- Drafts can be edited or deleted.
- A resolved item can be reopened: a comment goes back to draft, a question to `answered` (with an answer) or `open` (§11.2).

**The round (§5.3).**

- "Send comments (N)" counts the drafts, the "Other" answers and the unapplied answers (`isUnsent`). It is refused while a turn runs.
- The items become `sent` before the turn starts. If no turn starts (`RoundNotStarted`), they go back; once the round reached the agent, they stay sent.
- The message is `batchMessage`:

  ```
  Review round for specs/filter.md.
  Comments:
  - c3 on "The list loads at once." (## Scope): "Too slow for big lists"
  Custom answers:
  - c1 "Size only, or colour too?": "Size, colour and price"
  Edit the document, then answer each one with reply_to_comment.
  ```

- **Where the round goes** (`TaskManager.reviewRound`):
  - to the task that is waiting now, as the person's message;
  - with no task open, a new core task "Review <title>" (`REVIEW_PROMPT`), in the record's scope, at the document kind's `reviewTier` (`standard` without one);
  - while a turn runs, it is refused.

**Approval (§5.4).**

- "Approve" sends the blob of the version the reader showed. If the document changed since, the approval is refused with "changed", and the bar says to read it again first. The reader's file watch reads the text and the review again on any change, so the next "Approve" names the new version.
- With unsent items, the bar asks first: "Send first" or "Discard and approve". Discarding drops the drafts and puts "Other" and unapplied answers back to no answer.
- With a blocking question open, the button says "Approve · N blocking open". The approval needs "Approve anyway, with a reason": one line, 1 to 500 characters, stored on the approval.
- The approval waits for the turn like an answer, appends `{ blob, at, reason? }` and commits `Approved: <path>`. The commit includes the document, so the approved blob is always in the history.
- Approving the version already approved changes nothing.
- The document's task, when it is the open one, gets one line before its next message: "The person approved <path>." (plus ", with reason: …"). Lines are kept in `CurrentTask.notices` (at most 10, each up to 600 characters) and cost no extra turn (plan Q4).
- `approveNow` in `ReviewBar.tsx` is where a Sidekick hold would go.

**Stale.**

- A document whose bytes differ from the last approval's blob is "Changed since approval".
- "See what changed" draws the file timeline's diff (`timeline.md`) from the approval the record holds last to the current file, with `<FileDiff>`: word by word, inline or side by side. Main finds that approval on the timeline by its blob (`lastApproved`), never by position: after a whole-folder go-back the record's last approval can be older than the timeline's newest. It fetches again when the file's history changes or the reader reads the document again, and keeps its approval when a reload fails. Without a paired approval entry on the timeline, it says there is nothing to compare.
- Answers and approvals appear on the document's timeline ("Your answers", "v2 approved"): each `Answer:` and `Approved:` commit counts for the path its subject names.

**The reader.**

- A "Comments" column (`ReviewColumn.tsx`) sits right of the document; under 900 px it moves below it. There is no column until the first comment.
- Its cards are the questions with their options, "No answer" and "Other", and the comments with their replies. An answered question says "You can change the answer until you approve" while the document isn't approved.
- The footer bar (`ReviewBar.tsx`) has send, approve, the reason form and the approved or stale line. "See what changed" is `ApprovedDiff.tsx`.
- The review layout sits behind the `hh-reader-reviewing` class, so a reader without reviews keeps its layout.
- The chat's document cards show a chip with the summary:
  - "2 questions open" and "1 blocking";
  - "In review";
  - "Approved";
  - "Changed since approval".

  The window gets the chips from `hh:reviewSummaries`, and asks again when a record changes (`hh:reviewChanged`).

## Phases

A phase may declare `approve`, a glob of documents relative to the folder (`phases.md`):

- `*` and `?` match within one path part, and `**` matches any number of parts. Case is ignored.
- No `[`, `]`, `{` or `}`, no backslash, not absolute, no `..`, not under `.harness/`, ends in `.md`, at most 200 characters (`validApproveGlob`; matched by `matchGlob`, a hand-written matcher).

When the person approves a document that matches the open task's current phase's `approve`, and the task is waiting, the task moves to its next phase as if the person had picked it (`TaskManager.setPhase`, `by: "person"`). This holds whatever task made the record.

The move never happens from the last phase or a `close` phase. A stale document never moves the task back.

## Focus mode

"Focus" in the reader's header shows one document in a single quiet column (§6.2). Esc leaves focus mode from anywhere in the window, once the reader's own Esc steps are done: a prompt in the footer bar, the reading preferences, an open card. A panel open over it (History, Notes, Settings) closes first: the panel marks the Esc as handled (`preventDefault`), and the window's listener leaves it alone. "Leave focus" does the same.

- **Hidden:** the chat, the side panels and the table of contents. The comments column becomes margin markers (`FocusMarkers.tsx`), and a marker opens its one card. The footer bar is the last thing in the document column. What the person was typing in the bar survives entering and leaving.
- **Paused:** the composer taking focus and the live region reading the answer when a turn ends. Three notices are counted (`focus-notices.ts`):
  - the task is waiting for the person;
  - the plan's limit ran out (`out-of-quota`);
  - the agent proposed to move to another part.
- **Leaving** shows one line in the chat's notice row, also read out: "While you were reading: the task is waiting for you, …". Nothing held back: no line.
- `client.focus` tells a harness view: `current()` gives `{ on, path? }` and `onChange(listener)` listens, so the view can pause its own interruptions. Only the core's chat calls `set`.

## For harness views

`HarnessClient.documents` (`packages/protocol/src/client.ts`):

- **Reading:** `view(path)` (the record, the summary and the blob of the version read), `review(path)` (a `ReviewSummary` or null), `summaries(paths)` (at most 200 paths).
- **The person's actions:** `answer`, `comment`, `editDraft`, `reopen`, `send`, `approve(path, blob, { reason?, discard? })` and `approvedText`.
- **`approvedText(path)`** (`hh:reviewApprovedText`) answers the text of the last approved version. The core no longer uses it ("See what changed" diffs from the file's timeline, see `timeline.md`), but it stays as public harness API: a harness view may still read it.
- **Listening:** `onChange(listener)`.
- **Focus mode:** `focus(path)` opens the reader in focus mode, and the chat listens with `onFocus`.

Every call answers with data, and errors are data too. This differs from the spec's synchronous `review(path): ReviewSummary` and `approve(): Promise<void>` (plan Conflicts 5). The calls do something only when `AppState.review` is set. For any other harness, main answers "not-ready" and the summaries are all null.

## Terminal

`humanharness run` gives the agent the same three tools, but only for an edit-folder harness. It has its own `ReviewLocks` and calls `runReviewRequest` directly, since `ReviewService` needs the window.

Under each `Documents: <path> (<change>)` line it prints the document's review, when it has one (`reviewLine` in `packages/cli/src/terminal.ts`):

- `Review: approved`
- `Review: changed since approval`
- `Review: 2 questions open (1 blocking)`
- `Review: 1 comment open`
- `Review: in review`: a record with nothing open (for example only drafts). The spec doesn't name this case.

The CLI does not notify a window that has the same folder open when it changes a record. The window sees the change the next time it reads the review, for example when the document changes or opens again.

## D0

A harness whose agent can't edit the folder (`permissions.edit: "none"`, like the demo) keeps all of this byte for byte:

- its `ui` server's tool list (no review tools) and its `AGENTS.md` (no review lines);
- its `AppState` (no `review` field);
- its reader: no "Comments" column, no "Comment" button, no footer bar, no "Focus" button, no `hh-reader-reviewing` layout;
- its chat cards: no chip, no `hh:reviewSummaries` call;
- its history: the `hh:review*` handlers refuse, so no file under `.harness/reviews/` is ever made, and the kept prefix tracks nothing;
- its manifest validation (`approve` and `reviewTier` are optional);
- the output of `humanharness run`.

Two harmless changes reach every harness, this one included:

- the history skips `.<name>.md.<uuid>.tmp` files (the review's atomic writes of a document);
- Esc in the History, Notes and Settings panels is marked handled (`preventDefault`), so focus mode's window listener leaves it alone.

The tests that hold this: `packages/blocks/test/ui-server.test.ts` (unchanged), the runtime's and the CLI's edit-"none" tests, the reader's and the chat's, `review-ipc` and the e2e on the demo (`packages/e2e/fixtures/review-d0-mock`).

## Known gaps

- **Parallel tasks** don't exist yet (plan Conflicts 1). There is no `Who: person` trailer, and an answer or approval waits for any running turn, not only one that edits the file. "Jobs can't use the tools" has nothing to refuse.
- **No Sidekick `before-approve` moment** (Conflicts 3): an approval goes through at once.
- **Focus mode counts only the notices that exist.** Job results, Sidekick heads-ups and a Dock badge don't exist yet (Conflicts 4).
- **Marks are best-effort** (Q7). A quote whose rendered text differs from its projection gets no mark, for example in a table with inline markup or a footnote. Its card still shows and works.
- **Headings in a blockquote or a list item** get an id in the reader but start no section here. Later equal slugs may then be numbered differently from the reader's, and such an anchor falls back to a search of the whole text.
- **Comments need a pointer.** Selecting text for a comment needs a pointer, or the system's own selection keys once focus is in the text.
- **Lost lines.** The lines kept for the task (an approval's) are lost when the turn they were put before fails to start.
- **"Nearest to the old place"** (§7) is approximated: the last match in the section stands in for it, since no offset is stored.
- **Raw error text from other servers.** The `data` and `material` servers still forward a handler's error message to the agent as is; the review tools send only a refusal's message (outside this plan).
- **One lock per process.** `ReviewLocks` doesn't serialize the app and `humanharness run` working on the same folder.
- **Switching focus mode** remounts the footer bar. Its draft lives in the reader, but other local state starts again.
- **No "Comments · N" toggle in focus mode** (§6.2). The margin markers stand in for it: each opens its one card.
- **No ■ on blocking marks** (§6.1). A blocking question's mark in the text looks like any other; only its card has the "Blocking" badge.

## Where to look

- `packages/harness-sdk/src/review.ts`, `review-schema.ts`, `index.ts` (`approve`, `reviewTier`), `core-blocks.ts` (`REVIEW_TOOLS` in the reserved names).
- `packages/workspace/src/reviews.ts` (record files, locks, own documents, `blobId`, `reviewSummarySync`), `review-requests.ts`, `history.ts` (`readBlob`, the kept prefix), `layout.ts` (`REVIEWS_PREFIX`), `instructions.ts`.
- `packages/blocks/src/ui-server.ts`, `ui-server-bin.ts`, `launch.ts`; `packages/runtime/src/runtime.ts` (`review`, `reviewHandler`).
- `packages/shell/src/main/reviews.ts`, `review-ipc.ts`, `task-manager.ts` (`reviewRound`, `documentApproved`, `withNotices`), `task-prompts.ts` (`REVIEW_PROMPT`), `task-store.ts` (`notices`), `index.ts`, `packages/shell/src/preload/index.ts`.
- `packages/ui/src/review-marks.ts`, `ReviewColumn.tsx`, `ReviewBar.tsx`, `ApprovedDiff.tsx`, `FocusMarkers.tsx`, `focus-notices.ts`, `DocumentReader.tsx`, `DocumentCards.tsx`, `ChatView.tsx`, `client.ts`.
- `packages/cli/src/run.ts`, `terminal.ts`.
- `packages/fake-agent/fixtures/review-harness` (id `reviewer`) and `packages/e2e/tests/review.spec.ts`.
