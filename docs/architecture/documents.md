# Documents and the reader

Spec: `docs/superpowers/specs/2026-10-27-document-reader-design.md` ("§" and "D" below). Plan: `docs/superpowers/plans/2026-10-27-document-reader.md`.

## What it is

- One Markdown renderer serves the chat and the document reader: real headings with anchors, GFM tables, Mermaid diagrams, callouts, highlighted code, clickable links, task lists, footnotes and local images.
- The reader is a panel beside the chat (or full screen). It opens from the cards a turn leaves for the `.md` files it added or changed, from `.md` links, and from `client.openDocument(path)`.
- Every harness's `AGENTS.md` gets a "Writing for the reader" guide. A harness may also declare document kinds with `##` section templates; the reader checks them and only warns.

The pure helpers live in `packages/harness-sdk/src/documents.ts` (subpath `@humanharness/harness-sdk/documents`, no Node imports): `splitFrontMatter`, `slug` and `createSlugger`, `documentTitle`, `wordCount`, `readingMinutes` (230 words a minute), `isMarkdownPath` (`.md` only), `refusedShape`, `summarizeDocument`, `checkTemplate`, `CALLOUTS`, `DOCUMENT_KIND_ID`. The runtime, the CLI, the shell and the window all use them. Their line regexes are linear: a new regex on document text gets a timing test with about 50,000 spaces.

## The renderer

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

## Links and images

`packages/ui/src/doc-links.ts` decides (§3.4):

- `http(s)` → a link with `target="_blank"`; the shell's `setWindowOpenHandler` sends it to the system browser. Its domain shows next to the text, except for an autolink, whose label is already the URL (but never when the URL has a user part, `https://good.com@evil.com`). Its `aria-description` says it opens in the browser, without adding text to a copied selection.
- `#anchor` → scrolls inside the app, never a navigation.
- A relative `.md` (`adr-007.md`, `../notes/x.md#context`) → resolved from the document's own folder (`joinPath`) and opened in the reader, at the anchor. Its `href` is `#` plus the resolved path, never the raw URL.
- Anything else (`file:`, `javascript:`, `//host`, a relative non-`.md` file) → plain text with the URL after it.

Images: a remote one is never loaded; it shows as a link with its domain. A local one is read through `hh:readImage` as a data URL: PNG, JPEG, GIF or WebP up to 5 MB, no SVG. Until it arrives, or when it is refused, its alt text shows.

Opening documents and reading images need a `DocumentHost` (`packages/ui/src/documents-context.ts`: `open(path, anchor?)`, `image(path)`, `kinds?`) from `DocumentContext`. The chat and the reader provide one. Without a host, `.md` links are plain text and local images show their alt text.

## Mermaid

`packages/ui/src/mermaid-loader.ts` and `MermaidDiagram.tsx` (§3.3).

- `import("mermaid")` the first time a diagram appears, so a chat without diagrams loads nothing; it is its own chunk.
- `securityLevel: "strict"`, top-level `htmlLabels: false`, `suppressErrorRendering: true`. These keys are also in `secure`, so a diagram's init directive can't change them.
- Drawn one at a time, each raced against 15 s (`DRAW_TIMEOUT_MS`); a draw nobody wants any more (unmounted, theme changed) is skipped. The last 40 drawings are cached by code and theme.
- The theme variables come from the app's tokens; a theme switch draws again and keeps the old image until the new one is ready.
- The SVG shows as an `<img>` with a data URL, so nothing in it runs and its text can't be selected (Q8). The alt text is its caption, else the diagram's `accTitle`/`accDescr`. A Source toggle shows the code.
- An unclosed fence (a streaming answer) shows its source; a diagram that fails (or takes over 15 s) shows its source under one line saying why.

It renders under the app's current CSP; the CSP was not loosened.

## Cards

`packages/runtime/src/documents.ts`, `turnDocuments(history, before, after)`. After a successful turn's "Turn: …" commit, the runtime asks `History.changes` for the diff from the turn's "Before message" commit. Every added or changed `.md` becomes a `DocumentCard` (`path`, `title`, `kind?`, `change: "new" | "updated"`, `words`), read at the turn's commit:

- never a deleted file, a non-`.md` file, anything under `.harness/`, or a path `refusedShape` refuses (the reader would never open it);
- sorted by path, at most 20 (`MAX_CARDS`);
- only the first 1 MB of characters is read (`MAX_CARD_TEXT`): the title and kind come from it, and past it the word count is a floor;
- paths use forward slashes.

With at least one card the runtime sends a `documents` event right before `done` (`docs/architecture/turn.md`). A failure while listing them is logged and the turn still ends `ok`, without the event. Changes the person makes outside a turn make no card.

The shell's `TurnRecorder` saves them on the chat entry (`ChatEntry.documents`, absent without cards), so they come back when the task is reopened; the window's reducer keeps them on the live turn. `humanharness run` prints one line per card: `Documents: docs/overview.md (new)` (`packages/cli/src/terminal.ts`).

The window never trusts a saved entry: `cleanDocumentCards` (`packages/ui/src/card-shape.ts`) keeps a card only with a relative string path that `refusedShape` accepts, a string title, a string kind when there is one, a known change and a finite word count; at most 20, one per path. `DocumentCards.tsx` draws them under the answer: title, kind, "new" or "updated", reading time. `documentsExist` is asked when cards show, on window focus and whenever the reader finds a document missing (`onMissing`); a card whose file is gone is struck through and can't be clicked.

## The reader

`packages/ui/src/DocumentReader.tsx`, opened by `ChatView` (§5.2):

- The header bar: the path as breadcrumbs, Source, the "Aa" reading preferences, "Full screen"/"Show chat" and Close.
- The table of contents: `##` and `###`, following the scroll, with the template note at the bottom. It shows from the default 1100 px window up, and always in full screen; below 1000 px the side reader hides it.
- The document column: kind and status chips, when it last changed (mtime), the reading time (of the whole text), and the engine of the turn when opened from a card. The title from the front-matter is the `h1` that takes focus when a document opens.
- Source shows the whole raw text, read-only.
- Over 1 MB only the first 200 KB (cut on UTF-8 bytes, `cutToBytes`) is rendered, with a notice to open Source for all of it. Over 10 MB main refuses it ("too-large", with the size).
- Escape closes the reader when focus is inside it; focus goes back to what opened it from the chat (a card, a link), or to the composer.
- With the reader open, the harness's own side panel (`renderSide`) is hidden; full screen also hides the chat and the flow side panel. A slim chat never opens the reader.

Reading preferences (`font`: `sans`/`serif`, `size`: `normal`/`large`) are saved in `AppConfig.reader` (`cleanReaderPrefs`); the config keeps only its valid fields. They live only in the "Aa" menu (Q7).

### Main process

`packages/shell/src/main/documents.ts`, IPC in `index.ts`, errors as data:

- `hh:readDocument(path)` → `{ ok: true, text, mtime, size }` or `{ ok: false, reason }`: `outside`, `missing`, `not-markdown` or `too-large`. It never writes.
- `hh:readImage(path)` → a data URL or null.
- `hh:documentsExist(paths)` → one boolean per path; over 200 paths, every one is `false`, unchecked.
- `hh:watchDocument(path)` → a watch id or null; `hh:unwatchDocument(id)`.

Every path goes through the same checks. First `refusedShape`, before any file system call: not a string, empty, over 1000 characters, a NUL, a backslash (UNC too), absolute (`//host` too), a drive letter, or a `..` that climbs above the start: all `outside`. Then `locate` tries the person's folder, then each reference folder (Q12), and keeps a regular file whose real path stays in that root; a link pointing out is `outside`. `readCapped` checks again right before opening, opens with `O_NOFOLLOW | O_NONBLOCK` (a FIFO swapped in can't hang main), checks that the handle is still the file at that path and still inside, refuses a hard link (`nlink > 1`: its other names may be anywhere) and reads up to the cap. Documents must be `.md` or `.markdown`, both as asked and as found.

### Live reload

`DocumentWatchers` watches the document's folder (a file replaced by a rename is still seen) and reports a change after 150 ms of quiet. At most 16 watches are open (`MAX_WATCHES`); a new one closes the oldest. A watcher that fails (its folder moved or was deleted) is closed and reported as one last change, so the reader reads again and shows what happened.

`DocumentSessions` (`document-sessions.ts`) keeps the watches per window: a window unwatches only its own ids; its watches end when it closes or reloads; every watch ends when the folder or the reference folders change. Whenever a watch ends without its window asking (the folder changed, room was made, the watcher failed), main sends `hh:documentWatchEnded` with the id. The preload (`packages/shell/src/preload/document-watch.ts`, one listener per channel for all watches) then watches again and tells the reader, which reads again; after 3 re-watches (`MAX_REWATCHES`) it only tells the reader.

On a change the reader keeps its place at the heading nearest the top. Only the latest read draws; an older answer arriving late is dropped.

### The template check

`checkTemplate(kinds, front, sections)` runs whenever a document is drawn. It never blocks (§4.3):

- a required `##` section missing (trimmed, without case) → a note at the bottom of the table of contents;
- a `kind` the harness doesn't declare → a grey "unknown kind" chip;
- a `status` not in the kind's list → a warning next to the status chip;
- no `kind`, or no kinds declared → no check.

Extra sections and another order are fine. The manifest refuses a kind id that is not lowercase letters, digits and `-` or is over 64 characters, more than 20 kinds, a line break in `when`, a section or a status, and the same section or status twice. The window gets the kinds as `AppState.documents.kinds`, present only when the manifest declares `documents`.

## The SDK for harness views

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

## Agents

`packages/workspace/src/instructions.ts`, `writingLines`. The runtime always passes `writing: { kinds }` to `managedSection` (D4), so every harness's `AGENTS.md` has a "### Writing for the reader" part: structure, summary first, which element fits which content, the six callouts and no others, limits, no raw HTML, relative links, front-matter with `title`, and a short example. With kinds it also asks for `kind`, and a "### Document kinds" part lists each kind: its id, `when` and a template (the front-matter, the `status` values, the `##` headings in order), indented six spaces so it is a code block inside the list item and its `##` lines never render as headings. Without the `writing` option the managed section is byte for byte the old one.

`humanharness check` warns when the "Document kinds" part would add more than 400 tokens (`documents-tokens`).

## D0

A harness without `documents` still gets, as the spec says (Q1–Q3): the "Writing for the reader" part (one `AGENTS.md` rewrite, so the engine's cached prefix is rebuilt once), the richer chat Markdown (headings, links, tables, diagrams), and cards with the reader for any `.md` a turn writes. It gets no "Document kinds" part, no `AppState.documents`, no template check and no kind chips beyond the front-matter's own `kind`. `markdownToPlain` doesn't change.

## Dependencies

All in `@humanharness/ui`: `unified`, `remark-parse`, `remark-gfm`, `lowlight`, `highlight.js` (pinned `~11.11.0`, one copy with lowlight; only its grammar files), `mermaid` 12 (lazy), `@types/mdast` and `@types/hast` (dev). `packages/ui/src/client.ts` must never import any of them: the main process imports `@humanharness/ui/client`. Mermaid brings `elkjs`, under EPL-2.0: list it in the third-party notices when the app is packaged.

## Known gaps

- A timed-out Mermaid draw may keep running while the next one starts.
- A hard-linked file (`nlink > 1`) is refused, even inside the folder: for example a `.md` that pnpm hard-links from its store into `node_modules` does not open.
- The demo's own recordings write no documents (plan Q10: the demo is read-only); only the e2e recording `packages/e2e/fixtures/reader-mock` shows cards and the reader.
- Word counts include Markdown symbols, and past 1 MB the card's count is a floor.
- A `---` thematic break as the first line, with another `---` later, is read as broken front-matter: the text between is hidden.
- In a slim chat `openDocument` does nothing (no panel shows).
- The chat's `DocumentContext` doesn't reach a harness's own view: the view must provide its own memoised `DocumentHost` (see above).
- `mermaid` 12 pulls in `elkjs` (EPL-2.0): third-party notices must list it when the app is packaged.
