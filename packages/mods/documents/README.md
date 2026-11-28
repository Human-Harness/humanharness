# Documents

The reader, document reviews and file timelines, and the agent's side of the first two. Its main part reads a document
or an image inside the person's folder or a reference folder, says which paths exist, watches the open document, does the
person's side of a review, shows a file's timeline and diffs and takes one file back, and gives the agent the writing
guide and the three review tools.

Documents is a core mod: it ships with the app and is on by default.

## For agents

- `mod.json`: id `documents`, a `main` part and a `ui` part.
- `src/main.ts`: answers the app channels `hh:readDocument`, `hh:readImage`, `hh:documentsExist`, `hh:watchDocument`
  and `hh:unwatchDocument`, and pushes `hh:documentChanged` and `hh:documentWatchEnded` (core mods only). The roots come
  from `ctx.app.documents.folder()`.
- `src/main/documents.ts`: what may be read (it only ever reads, inside a root) and the file watchers.
- `src/main/document-ipc.ts`: the channels' handlers. Every input is untrusted and every failure is an answer.
- `src/main/document-sessions.ts`: the watches by window. They end when the window closes or reloads
  (`ctx.on.windowClosed`), the folder changes (`ctx.on.folderChanged`) or the mod goes off (`ctx.on.dispose`).
- `src/main/reviews.ts`: `ReviewService`, the person's side of a review. `src/main/app-reviews.ts` builds it from
  `ctx.app.documents`. A round the task manager could not start arrives as an error named `RoundNotStarted`; it is
  recognized by name, since a built mod does not share the shell's classes.
- `src/main/review-ipc.ts`: the app channels `hh:reviewView`, `hh:reviewSummaries`, `hh:reviewAnswer`,
  `hh:reviewComment`, `hh:reviewEditDraft`, `hh:reviewReopen`, `hh:reviewSend`, `hh:reviewApprove` and
  `hh:reviewApprovedText`. A change in a review, by either side, is pushed on `hh:reviewChanged`.
- `src/main/file-ipc.ts`: the app channels `hh:fileTimeline` and `hh:fileDiff`. Each commit's paths (null: too many to
  list) are pushed on `hh:fileCommits`, from `ctx.on.historyCommit`.
- `src/main/file-timeline.ts`: `FileTimelineService`, a file's timeline, its diffs and going back one file;
  `src/main/app-file-timeline.ts` builds it from `ctx.app.documents`. `hh:fileRestore` hands it to
  `ctx.app.history.restoreFile`: the core runs its checks, asks with the native dialog, and only after a yes gives it
  the restore guard to write through.
- `src/main/file-diff.ts`: what changed in a file (Markdown by blocks, text by lines, binary by size). The app computes
  it in a worker thread (`src/main/diff-runner.ts` and `src/main/diff-worker.ts`); the shell's build makes the worker's
  entry from this folder, and `ctx.app.documents.diffWorker()` says where it is. The view's types and the binary check
  stay in `@humanharness/workspace`.
- `src/main/agent.ts`: through `ctx.on.instructions` the writing guide, the harness's document kinds and the review
  rules; through `ctx.on.agentTools` the tools `ask_in_document`, `read_review` and `reply_to_comment`, only when the agent
  may edit the folder. In the app a tool call goes through `ReviewService`, so both sides share its locks.
- `src/schema.ts`: the config a harness gives under `mods.documents` (the document kinds). The manifest checks it
  (`@humanharness/harness-sdk` re-exports it), and the core reads the kinds with `documentsConfig` for the screen's
  template check, the guide and `humanharness check`.
- `src/ui.tsx`: registers the file opener and its panel. `src/ui/` holds the reader and the pieces of a review: the
  comment column, the bar, focus mode's margin markers, the marks on the text and the changes since the approval. Focus
  mode quiets the chat through `UiCtx.taskView.quiet`. It also holds a file's timeline and diffs: the reader's "File
  history", the split view the panel shows for a file the reader can't open (or a deleted `.md`), and the line and
  markdown diffs.
- With the mod off, the app answers each channel as its caller already handles it (`mods/app-channels.ts` in the shell):
  `not-ready` for a read, null for an image or a watch, false for every path; `not-ready` for each review channel,
  except `hh:reviewSummaries`, which answers null for every path; `not-ready` for `hh:fileTimeline`, `hh:fileDiff` and
  `hh:fileRestore`, and no `hh:fileCommits` push. The agent gets no guide and no review tools.
- With no app (a headless run), the main registers only `instructions` and `agentTools`. A tool call then writes the
  review in the run's folder, under the open task (`ctx.tasks.running`).

The rest of this file is the design of the three features: [the reader and documents](#the-reader-and-documents),
[reviews and focus mode](#document-reviews-and-focus-mode) and [file timelines](#file-timeline). The renderer
(`Markdown`), the document cards, the reader's slot and quiet mode stay in the core (`@humanharness/ui`); the reader, the
review controls, the timeline and the diffs are this mod's. The seams between them are in `docs/architecture/mods.md`.

## The reader and documents

Spec: `docs/superpowers/specs/2026-10-27-document-reader-design.md` ("§" and "D" below). Plan: `docs/superpowers/plans/2026-10-27-document-reader.md`.

### What it is

- One Markdown renderer serves the chat and the document reader: real headings with anchors, GFM tables, Mermaid diagrams, callouts, highlighted code, clickable links, task lists, footnotes and local images.
- The reader is a panel beside the chat (or full screen), drawn by this mod. It opens from the cards a turn leaves for the `.md` files it added or changed, from `.md` links, and from `client.openDocument(path)`.
- Every harness's `AGENTS.md` gets a "Writing for the reader" guide. A harness may also declare document kinds with `##` section templates; the reader checks them and only warns.

The pure helpers live in `packages/harness-sdk/src/documents.ts` (subpath `@humanharness/harness-sdk/documents`, no Node imports): `splitFrontMatter`, `slug` and `createSlugger`, `documentTitle`, `wordCount`, `readingMinutes` (230 words a minute), `isMarkdownPath` (`.md` only), `refusedShape`, `summarizeDocument`, `checkTemplate`, `CALLOUTS`, `DOCUMENT_KIND_ID`. The runtime, the CLI, the shell and the window all use them. Their line regexes are linear: a new regex on document text gets a timing test with about 50,000 spaces.

### The renderer

`packages/ui/src/markdown.tsx`. `unified` + `remark-parse` + `remark-gfm` give an mdast tree (`parseMarkdown`); our own walker turns it into React elements. There is no hast step and no raw-HTML path: an `html` node renders as text, inline or as a paragraph.

- Headings `#` to `####`: real `h1`–`h4`, each with an id from `createSlugger` (deduplicated: `a`, `a-1`), behind a prefix. In the chat the prefix is the component's own; the reader passes `idPrefix=""`. `#####` and deeper are bold paragraphs.
- Tables: a box that scrolls on its own (`role="region"`, focusable). `--:` columns are right-aligned with tabular numbers.
- ```` ```mermaid ````: a diagram (below). At most 20 per message or document (`MAX_DIAGRAMS`); later ones show as code.
- Callouts: a blockquote whose first line is `[!NOTE]`, `[!TIP]`, `[!WARNING]`, `[!SUMMARY]`, `[!DECISION]` or `[!QUESTION]` becomes a tinted box (`role="note"`, named by its label) with a line icon. Any other marker is a plain quote.
- Fenced code: highlighted by `lowlight` from its tree (`packages/ui/src/highlight.ts`; never from HTML strings), with the `title="…"` or language label and a Copy button ("Copied" or "Couldn't copy" for 2 s). Highlighting stops above 100,000 characters or 3000 lines, and waits for the closing fence while an answer streams.
- Inline code, bold, italics, strikethrough: as usual.
- Task lists: disabled checkboxes named by the item's text.
- Footnotes: listed at the end in the order they are first referenced, linked there and back. Their ids are `<prefix>fn:<id>` and `<prefix>fnref:<id>`; a heading slug never has a `:`, so they never collide.
- An italic paragraph right after a table or a diagram is its caption; a diagram's caption is also its image's alt text.
- Front-matter: hidden when `document` is set (the reader, a harness view).

In the chat a single newline is a line break and new words fade in. While an answer streams, a last line of only `-` or `=` is left out until more text follows, so the paragraph above never flashes as a setext heading. `Markdown` is `React.memo`: a streaming chat redraws only the growing message. `documentOutline(source)` gives the reader its `##`/`###` outline (with the same ids), its `##` texts for the template check and its front-matter.

`markdownToPlain` (the text read aloud) and its old parser live in `packages/ui/src/markdown-plain.ts`, unchanged since plan 10.

### Links and images

`packages/ui/src/doc-links.ts` decides (§3.4):

- `http(s)` → a link with `target="_blank"`; the shell's `setWindowOpenHandler` sends it to the system browser. Its domain shows next to the text, except for an autolink, whose label is already the URL (but never when the URL has a user part, `https://good.com@evil.com`). Its `aria-description` says it opens in the browser, without adding text to a copied selection.
- `#anchor` → scrolls inside the app, never a navigation.
- A relative `.md` (`adr-007.md`, `../notes/x.md#context`) → resolved from the document's own folder (`joinPath`) and opened in the reader, at the anchor. Its `href` is `#` plus the resolved path, never the raw URL.
- Anything else (`file:`, `javascript:`, `//host`, a relative non-`.md` file) → plain text with the URL after it.

Images: a remote one is never loaded; it shows as a link with its domain. A local one is read through `hh:readImage` as a data URL: PNG, JPEG, GIF or WebP up to 5 MB, no SVG. Until it arrives, or when it is refused, its alt text shows.

Opening documents and reading images need a `DocumentHost` (`packages/ui/src/documents-context.ts`: `open(path, anchor?)`, `image(path)`, `kinds?`) from `DocumentContext`. The chat and the reader provide one. Without a host, `.md` links are plain text and local images show their alt text.

### Mermaid

`packages/ui/src/mermaid-loader.ts` and `MermaidDiagram.tsx` (§3.3).

- `import("mermaid")` the first time a diagram appears, so a chat without diagrams loads nothing; it is its own chunk.
- `securityLevel: "strict"`, top-level `htmlLabels: false`, `suppressErrorRendering: true`. These keys are also in `secure`, so a diagram's init directive can't change them.
- Drawn one at a time, each raced against 15 s (`DRAW_TIMEOUT_MS`); a draw nobody wants any more (unmounted, theme changed) is skipped. The last 40 drawings are cached by code and theme.
- The theme variables come from the app's tokens; a theme switch draws again and keeps the old image until the new one is ready.
- The SVG shows as an `<img>` with a data URL, so nothing in it runs and its text can't be selected (Q8). The alt text is its caption, else the diagram's `accTitle`/`accDescr`. A Source toggle shows the code.
- An unclosed fence (a streaming answer) shows its source; a diagram that fails (or takes over 15 s) shows its source under one line saying why.

It renders under the app's current CSP; the CSP was not loosened.

### Cards

`packages/runtime/src/documents.ts`, `turnDocuments(history, before, after)`. After a successful turn's "Turn: …" commit, the runtime asks `History.changes` for the diff from the turn's "Before message" commit. Every added or changed `.md` becomes a `DocumentCard` (`path`, `title`, `kind?`, `change: "new" | "updated"`, `words`), read at the turn's commit:

- never a deleted file, a non-`.md` file, anything under `.harness/`, or a path `refusedShape` refuses (the reader would never open it);
- sorted by path, at most 20 (`MAX_CARDS`);
- only the first 1 MB of characters is read (`MAX_CARD_TEXT`): the title and kind come from it, and past it the word count is a floor;
- paths use forward slashes.

With at least one card the runtime sends a `documents` event right before `done` (`docs/architecture/turn.md`). A failure while listing them is logged and the turn still ends `ok`, without the event. Changes the person makes outside a turn make no card.

The shell's `TurnRecorder` saves them on the chat entry (`ChatEntry.documents`, absent without cards), so they come back when the task is reopened; the window's reducer keeps them on the live turn. `humanharness run` prints one line per card: `Documents: docs/overview.md (new)` (`packages/cli/src/terminal.ts`).

The window never trusts a saved entry: `cleanDocumentCards` (`packages/ui/src/card-shape.ts`) keeps a card only with a relative string path that `refusedShape` accepts, a string title, a string kind when there is one, a known change and a finite word count; at most 20, one per path. `DocumentCards.tsx` draws them under the answer: title, kind, "new" or "updated", reading time. `documentsExist` is asked when cards show, on window focus and whenever the reader finds a document missing (`onMissing`); a card whose file is gone is struck through and can't be clicked.

### The reader

`packages/mods/documents/src/ui/DocumentReader.tsx` (§5.2). The mod opens it: `src/ui.tsx` registers its panel
(`ctx.panel`) and its file opener (`ctx.openFile`). Every way a file opens in the task view goes through that handler
(`packages/ui/src/open-file.ts`, the core's side of the reader's slot; the core opens none itself). A `historyOnly`
target shows the file's timeline alone (`FileTimelineSplit`), any other one the reader.

- The header bar: the path as breadcrumbs, Source, the "Aa" reading preferences, "File history", "Full screen"/"Show chat" and Close.
- "File history" (every harness) toggles a drawer right of the document with the file's timeline. Picking an entry shows its diff in place of the text, with "Go back to this version" and "Back to the document"; the History panel's links open the reader with the drawer (`FileTarget.timeline`). In focus mode the drawer is hidden, and the button leaves focus mode. See [File timeline](#file-timeline).
- The table of contents: `##` and `###`, following the scroll, with the template note at the bottom. It shows from the default 1100 px window up, and always in full screen; below 1000 px the side reader hides it.
- The document column: kind and status chips, when it last changed (mtime), the reading time (of the whole text), and the engine of the turn when opened from a card. The title from the front-matter is the `h1` that takes focus when a document opens.
- Source shows the whole raw text, read-only.
- Over 1 MB only the first 200 KB (cut on UTF-8 bytes, `cutToBytes`) is rendered, with a notice to open Source for all of it. Over 10 MB main refuses it ("too-large", with the size).
- Escape closes the reader when focus is inside it; focus goes back to what opened it from the chat (a card, a link), or to the composer.
- With the reader open, the harness's own side panel (`renderSide`) is hidden; full screen also hides the chat and the flow side panel. A slim chat never opens the reader.
- In a harness whose agent may edit the folder (`AppState.review`), the reader also has:
  - a "Comments" column right of the document (below it under 900 px);
  - "Comment" on a text selection;
  - a footer bar to send comments and approve;
  - a "Focus" button in the header.

  See [Document reviews and focus mode](#document-reviews-and-focus-mode).

Reading preferences (`font`: `sans`/`serif`, `size`: `normal`; a stored `large` from before the style guide reads as `normal`) are saved in `AppConfig.reader` (`cleanReaderPrefs`); the config keeps only its valid fields. They live only in the "Aa" menu (Q7).

#### Main process

`packages/mods/documents/src/main/documents.ts`, the channels in `document-ipc.ts`, registered by `src/main.ts` with
`ctx.handle`; errors as data:

- `hh:readDocument(path)` → `{ ok: true, text, mtime, size }` or `{ ok: false, reason }`: `outside`, `missing`, `not-markdown` or `too-large`. It never writes.
- `hh:readImage(path)` → a data URL or null.
- `hh:documentsExist(paths)` → one boolean per path; over 200 paths, every one is `false`, unchecked.
- `hh:watchDocument(path)` → a watch id or null; `hh:unwatchDocument(id)`.

Every path goes through the same checks. First `refusedShape`, before any file system call: not a string, empty, over 1000 characters, a NUL, a backslash (UNC too), absolute (`//host` too), a drive letter, or a `..` that climbs above the start: all `outside`. Then `locate` tries the person's folder, then each reference folder (Q12), and keeps a regular file whose real path stays in that root; a link pointing out is `outside`. `readCapped` checks again right before opening, opens with `O_NOFOLLOW | O_NONBLOCK` (a FIFO swapped in can't hang main), checks that the handle is still the file at that path and still inside, refuses a hard link (`nlink > 1`: its other names may be anywhere) and reads up to the cap. `locate` and `readCapped` live in `packages/workspace/src/safe-read.ts`. Documents must be `.md` or `.markdown`, both as asked and as found.

#### Live reload

`DocumentWatchers` watches the document's folder (a file replaced by a rename is still seen) and reports a change after 150 ms of quiet. At most 16 watches are open (`MAX_WATCHES`); a new one closes the oldest. A watcher that fails (its folder moved or was deleted) is closed and reported as one last change, so the reader reads again and shows what happened.

`DocumentSessions` (`document-sessions.ts`) keeps the watches per window: a window unwatches only its own ids; its watches end when it closes or reloads; every watch ends when the folder or the reference folders change. Whenever a watch ends without its window asking (the folder changed, room was made, the watcher failed), main sends `hh:documentWatchEnded` with the id. The preload (`packages/shell/src/preload/document-watch.ts`, one listener per channel for all watches) then watches again and tells the reader, which reads again; after 3 re-watches (`MAX_REWATCHES`) it only tells the reader.

On a change the reader keeps its place at the heading nearest the top. Only the latest read draws; an older answer arriving late is dropped.

#### The template check

`checkTemplate(kinds, front, sections)` runs whenever a document is drawn. It never blocks (§4.3):

- a required `##` section missing (trimmed, without case) → a note at the bottom of the table of contents;
- a `kind` the harness doesn't declare → a grey "unknown kind" chip;
- a `status` not in the kind's list → a warning next to the status chip;
- no `kind`, or no kinds declared → no check.

Extra sections and another order are fine. The manifest refuses a kind id that is not lowercase letters, digits and `-` or is over 64 characters, more than 20 kinds, a line break in `when`, a section or a status, and the same section or status twice. The kinds are this mod's config, `mods.documents.kinds` (a top-level `documents` key is refused by name; the bare `{}` declares no kinds). The window gets them as `AppState.documents.kinds`, present only when there are kinds.

### Reviews

A harness whose agent may edit the folder can review documents in the reader:

- the agent asks about a passage with `ask_in_document`, and each option carries its replacement text;
- the person answers, comments on selected text and sends the comments as one round;
- the person approves a version, and a later change makes the approval stale.

Focus mode shows one document alone and holds the core's interruptions until the person leaves. Records live in `.harness/reviews/`. A phase may move on when a matching document is approved. See [Document reviews and focus mode](#document-reviews-and-focus-mode).

### The SDK for harness views

- `@humanharness/ui` exports `Markdown` (`<Markdown source={…} document path={…} />`), `MarkdownProps`, `DocumentContext` and `DocumentHost`.
- `HarnessClient` has `openDocument(path, anchor?)` and `onOpenDocument(listener)`: a harness view opens the reader with the first, the chat listens with the second from its first render. The path from a harness is untrusted: the reader checks it is a string and refuses a bad shape before any IPC.
- The chat's `DocumentContext` doesn't reach a harness's own view. A view that draws `Markdown` must provide its own `DocumentHost`, memoised (a new object each render reloads every local image), or its `.md` links are plain text and its local images show their alt text:

  ```tsx
  const host = useMemo<DocumentHost>(
    () => ({ open: (p, a) => client.openDocument(p, a), image: (p) => client.readImage(p).catch(() => null) }),
    [client],
  );
  return (
    <DocumentContext.Provider value={host}>
      <Markdown source={text} document path="docs/overview.md" />
    </DocumentContext.Provider>
  );
  ```

  `openDocument(path, anchor?)` passes the link's `#anchor` on; the chat keeps it only when it is a string.

### Agents

`packages/mods/documents/src/main/agent.ts`, `writingLines`. With the documents mod on, the shell and the CLI give the runtime these lines as one of its `instructions` sections (D4), which `managedSection` places after its own parts, so every harness's `AGENTS.md` has a "### Writing for the reader" part: structure, summary first, which element fits which content, the six callouts and no others, limits, no raw HTML, relative links, front-matter with `title`, and a short example. With kinds it also asks for `kind`, and a "### Document kinds" part lists each kind: its id, `when` and a template (the front-matter, the `status` values, the `##` headings in order), indented six spaces so it is a code block inside the list item and its `##` lines never render as headings. Without that section the managed section is byte for byte the old one.

`humanharness check` measures that part with this mod loaded headless (`packages/cli/src/check-document-kinds.ts`) and warns when "Document kinds" would add more than 400 tokens (`documents-tokens`).

### D0

A harness without document kinds still gets, as the spec says (Q1–Q3): the "Writing for the reader" part (one `AGENTS.md` rewrite, so the engine's cached prefix is rebuilt once), the richer chat Markdown (headings, links, tables, diagrams), and cards with the reader for any `.md` a turn writes. It gets no "Document kinds" part, no `AppState.documents`, no template check and no kind chips beyond the front-matter's own `kind`. `markdownToPlain` doesn't change. With this mod off, the agent gets no writing guide and no review tools, and no reader opens.

### Dependencies

The renderer's are all in `@humanharness/ui`: `unified`, `remark-parse`, `remark-gfm`, `lowlight`, `highlight.js` (pinned `~11.11.0`, one copy with lowlight; only its grammar files), `mermaid` 12 (lazy), `@types/mdast` and `@types/hast` (dev). The mod's diffs add `diff` (jsdiff) and parse Markdown with the same `unified` and `remark` packages. `packages/protocol` and `packages/ui/src/client.ts` must never import any of them: the contract stays renderer- and preload-safe. Mermaid brings `elkjs`, under EPL-2.0: list it in the third-party notices when the app is packaged.

### Known gaps

- A timed-out Mermaid draw may keep running while the next one starts.
- A hard-linked file (`nlink > 1`) is refused, even inside the folder: for example a `.md` that pnpm hard-links from its store into `node_modules` does not open.
- The demo's own recordings write no documents (plan Q10: the demo is read-only); only the e2e recording `packages/e2e/fixtures/reader-mock` shows cards and the reader.
- Word counts include Markdown symbols, and past 1 MB the card's count is a floor.
- A `---` thematic break as the first line, with another `---` later, is read as broken front-matter: the text between is hidden.
- In a slim chat `openDocument` does nothing (no panel shows).
- The chat's `DocumentContext` doesn't reach a harness's own view: the view must provide its own memoised `DocumentHost` (see above).
- `mermaid` 12 pulls in `elkjs` (EPL-2.0): third-party notices must list it when the app is packaged.

## Document reviews and focus mode

Spec: `docs/superpowers/specs/2026-10-27-document-review-and-focus-design.md` ("§" and "D" below). Plan: `docs/superpowers/plans/2026-10-28-document-review-and-focus.md`. It builds on [the reader](#the-reader-and-documents) and adds one key to task phases (`docs/architecture/phases.md`).

### What a review is

- **Questions.** The agent asks about a passage of a document it wrote, with 2 to 5 options. Each option carries the text that replaces the passage, so picking one swaps the passage at once: no turn, no tokens (D1). "Other" is a custom answer that goes to the agent.
- **Comments.** The person selects text in the reader and comments on it. Comments are drafts until the person sends them together as one review round: one turn (D2).
- **Rounds.** The agent edits the document for each item and answers each one with `reply_to_comment`.
- **Approval.** The person approves a version of the document. A later change makes the approval stale, and the reader shows what changed.

Reviews exist only for a harness whose agent may edit the folder (`permissions.edit: "folder"`). Every such harness gets the tools, three guide lines and the reader's controls, even if it never uses them (plan Q1). See D0 below.

The pure logic lives in `packages/harness-sdk/src/review.ts` (subpath `@humanharness/harness-sdk/review`, no Node imports, no zod). It covers sections, anchors, the projection, the swap, status and summary, the batch message, the line diff and the `approve` glob. The window, main, the runtime and the CLI all use it. The zod schema of the record is in `review-schema.ts`, used only by main and the CLI. As with the reader, every scan of document text is a hand-written loop or `indexOf`, never a regex that can backtrack, and the timing tests run on about 50,000 characters.

### The record

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
- The history tracks `.harness/reviews/` (see `docs/architecture/history.md`).

A record that fails the schema is "broken" (for example after a hand edit):

- The tools refuse with "the review of spec.md can't be read".
- The reader shows the document without review controls, with a note naming the file to fix or delete.

The person's documents are read and written only through `readOwnDocument` and `writeOwnDocument`. These accept only the person's folder (never a reference folder, never `.harness/`), only `.md`, and never a link or a hard-linked file. A write also needs the bytes on disk to still equal what was read under the lock, and a document is at most 10 MB (`MAX_REVIEW_DOCUMENT_BYTES`).

### Anchors

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

### The agent's tools

The mod defines `ask_in_document`, `reply_to_comment` and `read_review` (`src/main/agent.ts`, `ctx.on.agentTools`), and the agent finds them on the `ui` MCP server, next to the blocks:

- `ask_in_document({ path, quote, heading?, question, options, blocking? })`:
  - adds an `open` question and returns `{ id }`;
  - `options`: 2 to 5, each `{ label, text }` (label up to 120 characters);
  - `question`: up to 500 characters;
  - `heading`: a slug, with one leading `#` allowed.
- `reply_to_comment({ path, id, reply, resolve })`:
  - adds a reply;
  - `resolve: true` resolves the item, `false` keeps it `open` (the agent asks something back).
- `read_review({ path })`: the comments and questions not resolved and not drafts, with their answers and their state (`lost` worked out from the text), and the document's status (`none`, `draft`, `approved`, `stale`).

The `ui` bridge only answers "ok", so these tools use a request/answer channel of their own: an `Rpc` like the `data` server's. It is the runtime's channel for any tool its caller adds (`agentTools`, served by `packages/blocks/src/agent-tools.ts`: definitions with a JSON Schema, `tasksOnly`, one handler). The socket, the token and the definitions reach the server as `HH_TOOLS_RPC`, `HH_TOOLS_RPC_TOKEN` and `HH_TOOLS_RPC_DEFS`, and each call is `{ tool, args }`. This mod gives the three tools and the writing guide, in the shell and in `humanharness run`, and turns a call into a request. Each request goes to `runReviewRequest` (`packages/workspace/src/review-requests.ts`).

`documentsAgent` gives the tools only when the agent may edit the folder, and the runtime opens the channel only for a slot offered a tool (never a step's; a job's only for tools that are not `tasksOnly`). Its `reviewHandler` passes the agent only a `ReviewRefused` message. Any other failure (a file system error that names paths) becomes "The app could not do that. Nothing was saved; do not retry in a loop." A timeout says "The app did not answer; check with read_review before asking again".

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

With the tools, `AGENTS.md`'s "Writing for the reader" part gets three more lines (`TEXT.reviewRules`, added by `writingLines` in `src/main/agent.ts`):

- use `ask_in_document`, with the full replacement text for each option;
- mark a question `blocking` only when the document can't be approved without its answer;
- after a review round, answer every comment with `reply_to_comment`.

### The person's side

`ReviewService` (`packages/mods/documents/src/main/reviews.ts`) does the person's side. The window reaches it through the `hh:review*` channels (`review-ipc.ts`, registered by `src/main.ts` with `ctx.handle`), and every answer is data (`{ ok: false, reason }`, never a thrown error). Its locks are the same ones the runtime's handler uses (`reviews.agent(base, request)`).

**Answers (§5.1).**

- An option swaps the passage for its text. The first answer keeps the passage as `original`, and "No answer" puts it back. "Other" keeps the passage and goes in the next round.
- **The swap guard.** When the passage is no longer where its anchor says (strictly in its section), nothing is swapped. The answer is marked `unapplied` and travels in the next round. The card says so.
- **Waiting for the turn.** An answer waits until no turn runs (`TaskManager.whenSettled`, which the mod reaches as `ctx.app.documents.whenSettled`); meanwhile the card says "Waiting for the turn to end". Then it writes the document and the record and commits `Answer: <path> · <question>` with the open task's trailer.
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
- "See what changed" draws [the file timeline](#file-timeline)'s diff from the approval the record holds last to the current file, with `<FileDiff>`: word by word, inline or side by side. Main finds that approval on the timeline by its blob (`lastApproved`), never by position: after a whole-folder go-back the record's last approval can be older than the timeline's newest. It fetches again when the file's history changes or the reader reads the document again, and keeps its approval when a reload fails. Without a paired approval entry on the timeline, it says there is nothing to compare.
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

### Phases

A phase may declare `approve`, a glob of documents relative to the folder (`docs/architecture/phases.md`):

- `*` and `?` match within one path part, and `**` matches any number of parts. Case is ignored.
- No `[`, `]`, `{` or `}`, no backslash, not absolute, no `..`, not under `.harness/`, ends in `.md`, at most 200 characters (`validApproveGlob`; matched by `matchGlob`, a hand-written matcher).

When the person approves a document that matches the open task's current phase's `approve`, and the task is waiting, the task moves to its next phase as if the person had picked it (`TaskManager.setPhase`, `by: "person"`). This holds whatever task made the record.

The move never happens from the last phase or a `close` phase. A stale document never moves the task back.

### Focus mode

"Focus" in the reader's header shows one document in a single quiet column (§6.2). The mod asks the core for it with `ctx.taskView.quiet`: the core hides the chat and the side panels and holds its notices (`packages/ui/src/open-file.ts`), and only the open panel stays. Esc leaves focus mode from anywhere in the window, once the reader's own Esc steps are done: a prompt in the footer bar, the reading preferences, an open card. A panel open over it (History, Notes, Settings) closes first: the panel marks the Esc as handled (`preventDefault`), and the window's listener leaves it alone. "Leave focus" does the same.

- **Hidden:** the chat, the side panels and the table of contents. The comments column becomes margin markers (`FocusMarkers.tsx`), and a marker opens its one card. The footer bar is the last thing in the document column. What the person was typing in the bar survives entering and leaving.
- **Paused:** the composer taking focus and the live region reading the answer when a turn ends. Three notices are counted (`focus-notices.ts`):
  - the task is waiting for the person;
  - the plan's limit ran out (`out-of-quota`);
  - the agent proposed to move to another part.
- **Leaving** shows one line in the chat's notice row, also read out: "While you were reading: the task is waiting for you, …". Nothing held back: no line.
- `client.focus` tells a harness view: `current()` gives `{ on, path? }` and `onChange(listener)` listens, so the view can pause its own interruptions. The core and this mod call `set`: the mod when focus mode starts or follows a link, the core for `client.documents.focus` and when focus mode ends.

### For harness views

`HarnessClient.documents` (`packages/protocol/src/client.ts`):

- **Reading:** `view(path)` (the record, the summary and the blob of the version read), `review(path)` (a `ReviewSummary` or null), `summaries(paths)` (at most 200 paths).
- **The person's actions:** `answer`, `comment`, `editDraft`, `reopen`, `send`, `approve(path, blob, { reason?, discard? })` and `approvedText`.
- **`approvedText(path)`** (`hh:reviewApprovedText`) answers the text of the last approved version. The core no longer uses it ("See what changed" diffs from the file's timeline, see [File timeline](#file-timeline)), but it stays as public harness API: a harness view may still read it.
- **Listening:** `onChange(listener)`.
- **Focus mode:** `focus(path)` opens the reader in focus mode, and the chat listens with `onFocus`. With this mod off, the review channels answer "not-ready" and every summary is null.

Every call answers with data, and errors are data too. This differs from the spec's synchronous `review(path): ReviewSummary` and `approve(): Promise<void>` (plan Conflicts 5). The calls do something only when `AppState.review` is set. For any other harness, main answers "not-ready" and the summaries are all null.

### Terminal

`humanharness run` gives the agent the same three tools, but only for an edit-folder harness. It loads the documents mod headless: with no `ctx.app`, the mod has its own `ReviewLocks` and calls `runReviewRequest` directly, since `ReviewService` needs the window.

Under each `Documents: <path> (<change>)` line it prints the document's review, when it has one (`reviewLine` in `packages/cli/src/terminal.ts`):

- `Review: approved`
- `Review: changed since approval`
- `Review: 2 questions open (1 blocking)`
- `Review: 1 comment open`
- `Review: in review`: a record with nothing open (for example only drafts). The spec doesn't name this case.

The CLI does not notify a window that has the same folder open when it changes a record. The window sees the change the next time it reads the review, for example when the document changes or opens again.

### D0

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

The tests that hold this: `packages/blocks/test/ui-server.test.ts` (unchanged), the runtime's and the CLI's edit-"none" tests, this mod's reader tests and the chat's, its `review-ipc` test and the e2e on the demo (`packages/e2e/fixtures/review-d0-mock`).

### Known gaps

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

### Where to look

- `packages/harness-sdk/src/review.ts`, `review-schema.ts`, `index.ts` (`approve`, `reviewTier`), `core-blocks.ts` (`REVIEW_TOOLS` in the reserved names).
- `packages/workspace/src/reviews.ts` (record files, locks, own documents, `blobId`, `reviewSummarySync`), `review-requests.ts`, `history.ts` (`readBlob`, the kept prefix), `layout.ts` (`REVIEWS_PREFIX`).
- `packages/blocks/src/ui-server.ts`, `ui-server-bin.ts`, `launch.ts`, `agent-tools.ts`; `packages/runtime/src/runtime.ts` and `workspace.ts` (`instructions`, `agentTools`).
- This mod: `src/main/agent.ts` (`documentsAgent`, `reviewHandler`), `reviews.ts`, `review-ipc.ts`, `app-reviews.ts`; `src/ui/ReviewColumn.tsx`, `ReviewBar.tsx`, `ApprovedDiff.tsx`, `FocusMarkers.tsx`, `review-marks.ts`, `DocumentReader.tsx`.
- The core: `packages/shell/src/main/review-round.ts` (`RoundNotStarted`), `task-manager.ts` (`reviewRound`, `documentApproved`, `withNotices`), `task-prompts.ts` (`REVIEW_PROMPT`), `task-store.ts` (`notices`), `mods/core-documents.ts` (`ctx.app.documents`); `packages/ui/src/focus-notices.ts`, `open-file.ts`, `DocumentCards.tsx`, `ChatView.tsx`; `packages/protocol/src/{client,views}.ts`.
- `packages/cli/src/run.ts`, `terminal.ts`.
- `packages/fake-agent/fixtures/review-harness` (id `reviewer`) and `packages/e2e/tests/review.spec.ts`.

## File timeline

Spec: `docs/superpowers/specs/2026-10-27-file-timeline-design.md` ("§" and "D" below). Plan: `docs/superpowers/plans/2026-10-28-file-timeline.md`. It builds on the history (`docs/architecture/history.md`), [the reader](#the-reader-and-documents) and [document review](#document-reviews-and-focus-mode).

### What a timeline is

- Every file the history tracks has one: the changes made to that file, newest first, each with who made it (you, the agent of a task, or "Outside the app"). An entry opens its diff.
- Three places show it:
  - the reader's "File history" drawer, for a `.md` document;
  - the History panel, whose changed files are links to their timelines;
  - the timeline panel (`FileTimelineSplit`), for any other file and for a deleted `.md`.
- It is part of this mod, a core mod that is on by default: the same for every harness, including those whose agent can't edit the folder, like the demo (plan Q1). It reads the history every harness already has and adds nothing to the manifest, the agent or `AppState` (see D0).

### Entries

`groupTimeline` in `packages/workspace/src/file-timeline.ts` (pure) turns the commits that touched one path into `TimelineEntry[]`. Each commit is classified by its subject first, then by its `Task:` trailer (`classifyCommit`), in this order:

| Kind | Commits |
|---|---|
| `answers` | `Answer: <path> · …` naming this path (matched as the whole path then the separator, so a name holding " · " still works) |
| `approval` | `Approved: <path>` naming exactly this path |
| `goBack` | `Go back: …`, `Went back to an earlier point`, `Went back to before the task`, `Undo: …` |
| `outside` | `Start`, `Before message`, and an `Answer:`/`Approved:` naming another path (it only swept up the person's edits) |
| `task` | any other commit with a `Task:` trailer |
| `outside` | anything else |

- **Merging.** Consecutive `task` commits with the same `Task:` merge into one entry, which expands into its turns; so do consecutive `answers`. Every other kind is one entry per commit.
- **`from`, `to`, `at`.** `from` is the parent of the entry's first commit (`null` for the history's very first commit), `to` its last commit, `at` the author time of `to`.
- **Approvals** are numbered v1, v2, … from the oldest commit of the file the timeline reads. An `answers` entry is `unapproved` ("not approved") unless an approval follows it (one pass: only answers after the last approval). Every entry carries `blob`, the file's blob id at `to` (absent when deleted).
- **Pairing with the review record, by blob.** Main pairs the timeline's approval entries with the record's approvals by blob, both newest first, never by position: a whole-folder go-back takes the record back too, so the timeline can hold approvals the record no longer has. A paired approval made with a reason gets `reason: true`; the one paired with the record's last approval gets `lastApproved: true`, which "See what changed" starts from.
- **`deleted`.** An entry whose `to` has no file at the path is "Deleted". It has no "Go back to this version" (main refuses it with `deleted`); the entry before it keeps its go-back, which brings the file back.
- **`back`.** A `goBack` entry finds what it went back to by blob: the newest earlier entry whose `to` has the same blob. An approval gives `back: { version }` ("You went back to v2"), any other entry `back: { at }` ("You went back to the version of 10:41"), none "You went back to an earlier version". The subject is never parsed for this.
- **Authors.** `task` → the task's agent (the action's label, or "A question"); `answers`, `approval` and `goBack` → "You", except a crash undo (`Undo: …`, which carries the task's trailer and undoes that agent's turn) → the task's agent (Q3); `outside` → "Outside the app". A `Before message` commit holds the person's own edits made between turns, so it is `outside`, not the task's (Q2).
- `label` on an entry is English data for harness views and logs. The window never draws it: it builds its own text from `kind`, the commit count, `version`, `back`, `deleted` and `reason` through the `timeline.*` keys.
- **The 1,000-commit cap.** A timeline reads at most the newest 1,000 commits of the file (`MAX_TIMELINE_COMMITS`, Q7). Approvals are numbered within that window, so once older approvals fall out of it, the numbers shift down (v3 can become v1).

Main (`FileTimelineService`, `src/main/file-timeline.ts`) keeps up to 32 timelines per history, each keyed on the path's newest commit, so a commit notice doesn't rebuild one (about 0.7 s at 1,000 commits).

### The index

`packages/workspace/src/file-index.ts`. Which commits touched a path comes from an index, not from walking the log on every read:

- **Where.** `<historyDir>/hh-file-index.json`: inside the history's git data folder, next to git's own files (Q6; the spec named a sibling `file-index.json`). It moves, is set aside and is pruned with the history. It never enters the person's folder or a commit: isomorphic-git ignores files it doesn't know in its data folder.
- **Shape.** `{ "version": 1, "head": "<sha>", "paths": { "<path>": ["<sha>", … oldest first] } }`, written through a temp file and a rename. A file over 256 MiB (`MAX_INDEX_BYTES`), with more than 1,000,000 paths (`MAX_INDEX_PATHS`) or commits on one path (`MAX_PATH_COMMITS`), or with an empty, absolute or NUL-bearing key, is ignored and rebuilt.
- **A commit's paths** are the tracked paths it changed, plus the path its subject names: `Approved: <path>` changes only the review record, but belongs on the document's timeline. Indexing doesn't filter through one `History`'s keep and ignore lists, since every `History` on the same git data shares the file.
- **After each commit** (`History.saveNow` → `committed`) only the index `History` holds in memory advances, in place, and only when the commit's parent is its `head`. The file is written off the commit path: `INDEX_WRITE_DELAY_MS` (1 s) after the last commit, one write for a burst, never awaited by the commit; `History.flush()` writes it at once, and `flushFileIndexes()` flushes every `History` with a pending write. The runtime's `close` flushes its history; the app flushes on quit and before a folder move. A write that fails is logged (quietly when the git data is gone) and never fails a commit; a write that never happens costs a short catch-up on the next read. Then `History.onCommit` listeners get the commit's paths.
- **On read** (`History.fileCommits`), when the index's `head` isn't HEAD (another `History` instance committed, the file was missing, or it was refused), it walks first parents back from HEAD: to the index's `head`, catching up on the commits after it; or, when that head isn't found, down to the first commit, a full rebuild. One walk at a time per `History` (a shared promise, never joined by a read that started after a later commit); the window shows "Loading history…" meanwhile. The index a read caught up or rebuilt becomes the one `History` holds and is written the same delayed way. Reads at HEAD use the in-memory index and never touch the file, so an index file that can't be written costs one rebuild, not one per read.
- **Never a source of truth.** Deleting it costs one rebuild.
- **Cost.** A commit adds its paths to the in-memory lists; nothing is written on its path. Measured with `History.save` on a 300-file folder and an index already loaded: about 76 ms per save whatever the index's size (empty, 10,000 commits × 5 paths, 100,000 × 5, 100,000 × 20, a 92 MB file), where writing it on each commit took 117 ms, 325 ms and 1,239 ms at those sizes. The delayed write itself takes 5 ms at 2.4 MB, 33 ms at 23 MB and 173 ms at 92 MB, once per burst of commits.

### The diff

**In main** (`diffFile` in `src/main/file-diff.ts`; the view's types and `isBinary` are in `packages/workspace/src/diff-view.ts`), so `client.files.diff` is plain IPC for harness views too and the cap applies where the bytes are read. It answers data (`FileDiffView`): `markdown` (blocks plus a line diff of the source), `text` (lines and a language) or `binary` (both sizes). jsdiff 9 (`diff`) does the comparing; the Markdown parse is the reader's (`unified` + `remark-parse` + `remark-gfm`).

- **Binary**: a NUL in the first 8 KB of either side, or an extension in a fixed list (images, audio, video, archives, office files, PDFs, fonts, databases, executables). Shown as "Binary file, no preview" with both sizes.
- **The cut**: each side is cut to its first 200 KB (`MAX_DIFF_BYTES`, backed up to a whole UTF-8 character), with `truncated: true` and a notice. Main reads no more than that of a historical blob or the current file (`History.readBytesAt(sha, file, max)`, `readPrefix`). `same` comes from the blob ids and sizes, never from the cut bytes, so two big files that differ only past the cut aren't "the same".
- **Blocks** (`markdownBlocks`): front-matter (one block), headings, paragraphs, each item of a top-level list (nested lists stay in their item), each table row, code fences, Mermaid fences, callouts and other blockquotes (one block each), thematic breaks and HTML (`other`). `diffMarkdown` aligns them with `diffArrays` on their source. Inside a run of removed-then-added blocks, the i-th removed and the i-th added pair up when they are the same type and become one `changed` block; the rest stay `removed` and `added`. A moved paragraph is a removal plus an addition.
- **Inside a changed block**: a text block carries word parts (`diffWordsWithSpace` over its plain text; Q5); a code, Mermaid or front-matter block carries line changes; a table row carries word parts per cell.
- **Line diffs travel compact.** A whole file's line diff (the `text` view, and a Markdown view's `source`) keeps only its changes and up to 3 unchanged lines around each (`DIFF_CONTEXT_LINES`, the window's own context); every run left out becomes one `gap` line with its `count` (`compactLines`). At most 10,000 lines go out (`MAX_DIFF_LINES`, gaps not counted); past that the rest is cut and the view says `truncated`. So 200 KB of short lines with one change answers a few hundred bytes, not about 7 MB. Lines lose a CRLF's `\r`.
- **Time.** The parse comes first; then one 2-second budget (`DIFF_TIMEOUT_MS`) is shared by every jsdiff call of the file, passed as jsdiff's `timeout`. A piece that runs out shows as all removed, then all added; once the budget is spent the rest is compared block by block only.
- **Limits on the Markdown view.** The parser is superlinear on some inputs, so a linear pre-scan (`parseableMarkdown`) sends a file to the plain line view when it has more than 16 container markers opening one line, an indent over 128 columns, `[` nested over 32 deep in a paragraph, a delimiter cost over 4,000,000 (the sum over paragraphs of the count of `*`, `_`, `~`, `[`, `]` squared) or over 1,000 setext underlines. Measured on this repo's 120 Markdown files: at most 6 columns of indent and a cost of 16,283. A parse that throws (200 KB of `>` overflows the stack) also gives the line view. So does a side with more than 5,000 blocks (`MAX_DIFF_BLOCKS`) or blocks carrying more than about 2,000,000 characters (`MAX_DIFF_OUTPUT`). Two identical sides stop early with no blocks, and unchanged blocks carry only their `after`.
- **In a worker thread.** jsdiff and the parse are synchronous, so the app runs each diff in its own worker thread (`workerDiff` in `src/main/diff-runner.ts`; the shell's build makes the `diff-worker.js` entry from this mod's `src/main/diff-worker.ts`, `ctx.app.documents.diffWorker()` says where it is, and the worker side is made at the first diff): a 512 MB heap, killed after 15 s (`DIFF_WORKER_TIMEOUT_MS`). At most 2 run at once (`DIFF_WORKERS_AT_ONCE`) and 8 more wait (`DIFF_WORKERS_WAITING`); one past that answers "failed". When a `.md` diff's worker gives up, main falls back to the plain line view in process with a 250 ms budget (`IN_PROCESS_DIFF_MS`), no parse. Without a worker (tests, a caller that passes none), `inProcessDiff` uses that same small budget.
- **Links.** The history stores a link as its target's path, never what it points to. When the file in the folder, or a folder on its way, is a link, the diff against the current file is refused as `unsafe`.

**In the window** (`src/ui/FileDiff.tsx`), the diff is only drawn:

- Unchanged, added and removed blocks are drawn whole with the reader's `<Markdown>`. A changed block shows its plain text with `<ins>`/`<del>` word marks: bold, links and code spans aren't drawn inside it (Q5). Code and other text files are line tables, highlighted up to 3,000 lines. Long unchanged runs of lines fold to a few lines of context around each change (`aroundChanges`); a `gap` line main sent is always drawn as a gap, in both layouts.
- Nothing becomes HTML: diff text is React text nodes in `<ins>`, `<del>` and `<span>`, and colours are the green and red tag tokens (`--hh-t-green`, `--hh-t-red` and their `-ink`). The CSP is unchanged.
- **Inline or side by side.** Side by side draws inline while the diff's own box is narrower than 900 px, measured with `ResizeObserver` (Q12); the switch keeps the choice for when it widens. Changed cells carry a sign and a hidden "Added"/"Removed", and the columns hidden "Before"/"After" labels, so the colour isn't the only signal.
- **Source** shows the line diff of the raw text. A changed Mermaid fence shows the diagram before and after, with its own Source toggle.

### Going back one file

`client.files.restore(path, commit)`, where `commit` is an entry's `to` (§5):

1. The preload (`restoreFlow` in `packages/shell/src/preload/file-restore.ts`) makes one call, `hh:fileRestore`. An invoke that rejects (no handler, a closing window) answers `{ refused: "failed" }`, never a throw.
2. This mod answers `hh:fileRestore` (`ctx.handleFrom`) and hands its `FileTimelineService` to `ctx.app.history.restoreFile`. The core (`createGoBacks().file` in `packages/shell/src/main/go-back.ts`, through `history-restore.ts`) asks `FileTimelineService.restorePrompt` first: it checks the path and that `commit` is the `to` of an entry of this path's timeline; a `deleted` entry is refused, and so is a go-back while busy. A refusal asks nothing.
3. Main asks with a **native dialog**, a sheet on the window that asked (`dialog.showMessageBox`; see "Every go-back asks in main" in `docs/architecture/history.md`): "Go back to this version?", then "Go back {{file}} to how it was after {{author}} ({{ago}})? The rest of the folder doesn't change." (or "to v{{version}}, the version you approved" for an approval). The buttons are "Go back" and "Cancel"; Cancel is the default and the cancel id. A Cancel, or any failure to ask, answers `{ ok: false, reason: "cancelled" }`, which the client turns into `"cancelled"`; `EntryDiff` treats it quietly, as no change. A go-back never happens unconfirmed.
4. Only after a yes, the core calls `FileTimelineService.restore` with the restore guard, which works only while that go-back is live. The service checks again, then runs `History.restoreFile` through that `RestoreGuard`: one at a time, turns held meanwhile.

`History.restoreFile` writes one file with the restore's link checks (`docs/architecture/history.md`): `O_NOFOLLOW` where the OS has it, the parent's real path checked before and right after `mkdir`. A file that is a symbolic or hard link to an outside file is replaced, and the outside file never changes; the commit that deleted the file is not a version to go back to. A path it can't write safely is skipped and the answer is `unsafe`. The commit is `Go back: <path> to <target>`, where `<target>` is `v2` for an approval and `the version of <ISO time>` otherwise. It is untagged, like every restore, and stages only that path, so the person's other uncommitted edits wait for the next commit. The go-back is itself an entry and can be undone the same way.

- Refused with `busy` while a turn or a task operation runs or turns are held (the rule of today's restores; plan Conflicts 1), checked before the confirmation and again after it.
- Content already equal to that version makes no commit; the answer is still `"restored"` (Q9).
- After a go-back main tells the settings, as the other restores do (a `.harness/data/` file may have gone back).
- A reviewed document that goes back becomes stale ("Changed since approval") unless it went back to the approved version. Its record stays as it is.

**Trust (Q4, decided by Marco on 2026-10-28).** Harness UI code runs in the core's own realm (one bundle, one frame), so a confirmation drawn in the window could be answered by harness code. The confirmation is therefore main's native dialog, for this go-back and for the whole-folder and task go-backs (`docs/architecture/history.md`). Nothing in the window can answer it. The in-window confirmation (`files.hostConfirm`, `RestoreConfirm`) is gone; no harness used it.

### For harness views

`HarnessClient.files` (`packages/protocol/src/client.ts`); every call answers with data, refusals are `FileRefusal`: `not-ready`, `outside`, `untracked`, `bad-input`, `not-found`, `deleted`, `busy`, `unsafe`, `failed`.

- `timeline(path)` → `{ ok: true, entries } | { ok: false, reason }` (plan Conflicts 5).
- `diff(path, from, to)` → `FileDiffView | { ok: false, reason }`; `from` null is "nothing before", `to` a commit or `"current"`. It takes any two commits that are the `from` or `to` of an entry on that path's timeline.
- `restore(path, commit)` → `"restored" | "cancelled" | { refused }`. Main always confirms with its native dialog; `"cancelled"` means the person said no.
- `onChange(path, listener)`: a commit touched the path. This mod pushes `hh:fileCommits` from `ctx.on.historyCommit` with each commit's paths, or null for a commit that changed more than 200 (`MAX_ANNOUNCED_PATHS` in `packages/shell/src/main/commit-announcer.ts`, a big `Start`): then every watched path hears it. The preload keeps one ipc listener for all of them (`fileCommitListeners`).

Main checks every path: `refusedShape` first, then inside the person's folder (a `.md` in its canonical spelling) and tracked. Reference folders are never read or written here. The mod's components (`src/ui/`; `@humanharness/ui` no longer exports them) take the client like `MaterialPanel`:

- `<FileTimeline client path selected? onPick? />`: the entry list (read-only without `onPick`), with its chips: "not approved", "v2 approved", "Outside the app", "Deleted".
- `<FileDiff client path from to layout? refresh? />`: the diff, both layouts and the Source toggle. Change `refresh` to fetch the diff again (the file now may have changed).

### In the app

- **The reader** (`DocumentReader.tsx`): "File history" in the header (Q8: the top bar already has "History") toggles a drawer (`<section aria-label="File history">`) right of the document. Picking an entry replaces the text with `EntryDiff`: "What changed here" / "Against the current version", "Inline" / "Side by side", "Go back to this version" and "Back to the document". "Against the current version" asks again after a commit to the file and when the reader reads the text again (`EntryDiff`'s `refresh`). The review footer bar and the "Comment" button hide while a diff shows. Back from a diff, the document returns to the place it had (its heading at the top when the diff opened) and its review marks are drawn again; focus that was in the diff (or nowhere) goes to the entry, focus the person put elsewhere stays. In focus mode the drawer is hidden; the button leaves focus mode and opens it. A narrow reader gets a 220 px drawer.
- **The History page** (`HistoryPage.tsx` in the history-view mod): with `onOpenFile`, an open row's changed files are links. An existing `.md` opens in the reader with the drawer (`FileTarget.timeline`, exactly `true`) and focus in the drawer, so the first Esc closes the drawer, not the reader; any other file, and a deleted `.md`, opens `FileTimelineSplit` (Q10). Each link's description is the change's kind ("Changed", "Deleted"…). Opening the reader closes the timeline panel, which would cover it. A `Go back: <path> to …` commit reads "You went back to an earlier version of <path>" (`history.entry.fileBack`).

### "See what changed"

A stale document's "See what changed" (`ApprovedDiff.tsx`, [reviews](#document-reviews-and-focus-mode)) is the timeline's diff from the `lastApproved` entry's `to` (the approval the review record holds last, paired by blob) to the current file, drawn with `<FileDiff>`. That is not always the newest approval entry: after a whole-folder go-back between v1 and v2, the record holds v1 again, and so does "See what changed". With no paired entry it says there is nothing to compare. It reloads on `files.onChange` and when the reader reads the text again; a reload that fails keeps the approval it had. Answers and approvals appear on the document's timeline. `client.documents.approvedText` (`hh:reviewApprovedText`), which "See what changed" used before, stays as public harness API though the core no longer calls it.

### D0

The timeline adds no manifest key, no agent tool and no instruction. For every harness and engine, byte for byte:

- the folder: the index lives in the history's git data, outside the folder, and no commit tree ever contains it;
- every commit's subject, trailers and tree: the index is written after the commit, off its path, and `restore`, `restoreReport` and `save` stage exactly what they staged before;
- `AGENTS.md` and the engine's instructions file; the `ui`, `data` and `material` MCP servers' tool lists;
- `AppState` (no new field);
- the output of `humanharness run`, which uses the same `History`;
- the History panel without `onOpenFile`: a harness view that renders it gets the old plain paths.

What the person sees that is new (the reader's "File history" button, the History page's links) is the same for every harness. With this mod off, nothing opens a file, and `hh:fileTimeline`, `hh:fileDiff` and `hh:fileRestore` answer "not-ready". The tests that hold this: `packages/workspace/test/history-index.test.ts`, `history-restore-file.test.ts`, `packages/mods/history-view/test/history-page.test.tsx` and the e2e in `packages/e2e/tests/review.spec.ts` (the index only in the app's data folder).

### Known gaps

- **Parallel tasks** don't exist yet (plan Conflicts 1): no per-file wait (a go-back waits for any running turn), no `Job:` author, no partial commits, so a shared path never shows two agents on one entry. `FileTimelineService.restorePrompt` is the one place a per-file check would go.
- **Reference folders have no history**: a path in a reference folder is outside the person's folder.
- **Linked folders have no timeline.** A tracked linked folder has its own core history (`docs/architecture/hatches.md`), but the timeline and its index cover only the main folder: its files show no timeline, and the "not covered" line shows only in the History panel (spec §3.4 names both).
- **Renames** start a new timeline; the old path's ends in "Deleted".
- **A crashed turn leaves no trace on a file.** The runtime restores the "Before message" point before any commit of that turn, so neither a task entry nor an `Undo:` entry shows (plan Conflicts 4).
- **Changed blocks drop inline formatting** (Q5): bold, links and code spans show as plain text with word marks.
- **No diff between two arbitrary entries in the UI** yet; `client.files.diff` already takes any two commits on the timeline.
- **The delayed index write blocks main once per burst.** Serialising a 92 MB index takes about 170 ms on Electron main, a second after the last commit of a burst. Smaller indexes take a few ms.
- **The reader's own parse.** The plan-10 reader parses with the same `remark` in the window, without this plan's pre-scan, so an adversarial `.md` can stall the reader's renderer. That predates this plan.
- **Version numbers shift** when older approvals fall outside the 1,000-commit window, and an approval older than that window can't be paired: "See what changed" then says there is nothing to compare.
- **The native dialog's look.** It is the system's, not the app's, and its text is the core's in the person's language (the cached translation, else English).
- **A path whose subject reads short.** `namedPath` cuts an answer's path at the first " · ", so the index lists a shorter path that doesn't exist for a document whose name holds it. The document's own timeline is right (`classifyCommit` matches the whole path).

### Where to look

- `packages/workspace/src/subjects.ts` (`ANSWER_PREFIX`, `ANSWER_SEPARATOR`, `APPROVED_PREFIX`, `FILE_RESTORE_PREFIX`), `file-timeline.ts` (`namedPath`, `classifyCommit`, `groupTimeline`), `file-index.ts`, `history.ts` (`tracks`, `onCommit`, `fileCommits`, `fileTimeline`, `readBytesAt`, `restoreFile`), `diff-view.ts`, `safe-read.ts` (`readPrefix`).
- This mod: `src/main/file-timeline.ts` (`FileTimelineService`), `app-file-timeline.ts`, `file-ipc.ts`, `file-diff.ts`, `diff-runner.ts`, `diff-worker.ts`; `src/ui/FileTimeline.tsx`, `FileDiff.tsx`, `EntryDiff.tsx`, `FileTimelineSplit.tsx`, `ApprovedDiff.tsx`, `DocumentReader.tsx`; `src/main.ts` (wiring, `hh:fileRestore`, `hh:fileCommits`).
- The core: `packages/shell/src/main/go-back.ts` and `history-restore.ts` (the go-back and its native dialog), `commit-announcer.ts`; `packages/shell/src/preload/file-restore.ts`, `file-commits.ts`, `index.ts`.
- `packages/protocol/src/client.ts` (`HarnessClient.files`); `packages/i18n/src/locales/en.json` (`timeline.*`).
- Tests: `packages/workspace/test/file-timeline.test.ts`, `file-index.test.ts`, `history-index.test.ts`, `history-timeline.test.ts`, `history-restore-file.test.ts`; this mod's `test/` (the service, `file-ipc`, the diffs, the timeline and reader components); `packages/shell/test/file-restore.test.ts`, `go-back.test.ts`, `history-restore.test.ts`, `file-commits.test.ts`; `packages/e2e/tests/review.spec.ts`.
