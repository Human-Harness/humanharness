# File timeline

Spec: `docs/superpowers/specs/2026-10-27-file-timeline-design.md` ("§" and "D" below). Plan: `docs/superpowers/plans/2026-10-28-file-timeline.md`. It builds on the history (`history.md`), the reader (`documents.md`) and document review (`reviews.md`).

## What a timeline is

- Every file the history tracks has one: the changes made to that file, newest first, each with who made it (you, the agent of a task, or "Outside the app"). An entry opens its diff.
- Three places show it:
  - the reader's "File history" drawer, for a `.md` document;
  - the History panel, whose changed files are links to their timelines;
  - the timeline panel (`FileTimelinePanel`), for any other file and for a deleted `.md`.
- It is core, the same for every harness, including those whose agent can't edit the folder, like the demo (plan Q1). It reads the history every harness already has and adds nothing to the manifest, the agent or `AppState` (see D0).

## Entries

`groupTimeline` in `packages/workspace/src/file-timeline.ts` (pure) turns the commits that touched one path into `TimelineEntry[]`. Each commit is classified by its subject first, then by its `Task:` trailer (`classifyCommit`), in this order:

| Kind | Commits |
|---|---|
| `answers` | `Answer: <path> · …` naming this path |
| `approval` | `Approved: <path>` naming this path |
| `goBack` | `Go back: …`, `Went back to an earlier point`, `Went back to before the task`, `Undo: …` |
| `outside` | `Start`, `Before message`, and an `Answer:`/`Approved:` naming another path (it only swept up the person's edits) |
| `task` | any other commit with a `Task:` trailer |
| `outside` | anything else |

- **Merging.** Consecutive `task` commits with the same `Task:` merge into one entry, which expands into its turns; so do consecutive `answers`. Every other kind is one entry per commit.
- **`from`, `to`, `at`.** `from` is the parent of the entry's first commit (`null` for the history's very first commit), `to` its last commit, `at` the author time of `to`.
- **Approvals** are numbered v1, v2, … from the oldest commit of the file the timeline reads. An `answers` entry is `unapproved` ("not approved") unless an approval follows it. An approval made with a reason gets `reason: true`: main pairs the timeline's approvals with the review record's, newest first.
- **`deleted`.** An entry whose `to` has no file at the path is "Deleted". It has no "Go back to this version" (main refuses it with `deleted`); the entry before it keeps its go-back, which brings the file back.
- **`back`.** A `goBack` entry finds what it went back to by blob: the newest earlier entry whose `to` has the same blob. An approval gives `back: { version }` ("You went back to v2"), any other entry `back: { at }` ("You went back to the version of 10:41"), none "You went back to an earlier version". The subject is never parsed for this.
- **Authors.** `task` → the task's agent (the action's label, or "A question"); `answers`, `approval` and `goBack` → "You", except a crash undo (`Undo: …`, which carries the task's trailer and undoes that agent's turn) → the task's agent (Q3); `outside` → "Outside the app". A `Before message` commit holds the person's own edits made between turns, so it is `outside`, not the task's (Q2).
- `label` on an entry is English data for harness views and logs. The window never draws it: it builds its own text from `kind`, the commit count, `version`, `back`, `deleted` and `reason` through the `timeline.*` keys.
- **The 1,000-commit cap.** A timeline reads at most the newest 1,000 commits of the file (`MAX_TIMELINE_COMMITS`, Q7). Approvals are numbered within that window, so once older approvals fall out of it, the numbers shift down (v3 can become v1).

Main (`FileTimelineService`) keeps up to 32 timelines per history, each keyed on the path's newest commit, so a commit notice doesn't rebuild one (about 0.7 s at 1,000 commits).

## The index

`packages/workspace/src/file-index.ts`. Which commits touched a path comes from an index, not from walking the log on every read:

- **Where.** `<historyDir>/hh-file-index.json`: inside the history's git data folder, next to git's own files (Q6; the spec named a sibling `file-index.json`). It moves, is set aside and is pruned with the history. It never enters the person's folder or a commit: isomorphic-git ignores files it doesn't know in its data folder.
- **Shape.** `{ "version": 1, "head": "<sha>", "paths": { "<path>": ["<sha>", … oldest first] } }`, written through a temp file and a rename. A file over 256 MiB (`MAX_INDEX_BYTES`), with more than 1,000,000 paths (`MAX_INDEX_PATHS`) or commits on one path (`MAX_PATH_COMMITS`), or with an empty, absolute or NUL-bearing key, is ignored and rebuilt.
- **A commit's paths** are the tracked paths it changed, plus the path its subject names: `Approved: <path>` changes only the review record, but belongs on the document's timeline. Indexing doesn't filter through one `History`'s keep and ignore lists, since every `History` on the same git data shares the file.
- **After each commit** (`History.saveNow` → `committed`) the index is updated only when the commit's parent is its `head`. A failure to update it is logged and never fails the commit. Then `History.onCommit` listeners get the commit's paths.
- **On read** (`History.fileCommits`), when the index's `head` isn't HEAD (another `History` instance committed, the file was missing, or it was refused), it walks first parents back from HEAD: to the index's `head`, catching up on the commits after it; or, when that head isn't found, down to the first commit, a full rebuild. One walk at a time per `History` (a shared promise, never joined by a read that started after a later commit); the window shows "Loading history…" meanwhile. The last index `History` computed is kept in memory, so an index file that can't be written costs one rebuild, not one per read.
- **Never a source of truth.** Deleting it costs one rebuild.
- **Cost.** Every commit rewrites the whole JSON. Measured: 10,000 commits × 5 paths, about 15 ms per commit; 50,000, 65 ms; 100,000 × 5, 126 ms; 100,000 × 20, 823 ms (a save of 300 files takes about 88 ms). See Known gaps.

## The diff

**In main** (`packages/workspace/src/file-diff.ts`, `diffFile`), so `client.files.diff` is plain IPC for harness views too and the cap applies where the bytes are read. It answers data (`FileDiffView`): `markdown` (blocks plus a line diff of the source), `text` (lines and a language) or `binary` (both sizes). jsdiff 9 (`diff`) does the comparing; the Markdown parse is the reader's (`unified` + `remark-parse` + `remark-gfm`).

- **Binary**: a NUL in the first 8 KB of either side, or an extension in a fixed list (images, audio, video, archives, office files, PDFs, fonts, databases, executables). Shown as "Binary file, no preview" with both sizes.
- **The cut**: each side is cut to its first 200 KB (`MAX_DIFF_BYTES`, backed up to a whole UTF-8 character), with `truncated: true` and a notice. Main reads no more than that of a historical blob or the current file (`History.readBytesAt(sha, file, max)`, `readPrefix`). `same` comes from the blob ids and sizes, never from the cut bytes, so two big files that differ only past the cut aren't "the same".
- **Blocks** (`markdownBlocks`): front-matter (one block), headings, paragraphs, each item of a top-level list (nested lists stay in their item), each table row, code fences, Mermaid fences, callouts and other blockquotes (one block each), thematic breaks and HTML (`other`). `diffMarkdown` aligns them with `diffArrays` on their source. Inside a run of removed-then-added blocks, the i-th removed and the i-th added pair up when they are the same type and become one `changed` block; the rest stay `removed` and `added`. A moved paragraph is a removal plus an addition.
- **Inside a changed block**: a text block carries word parts (`diffWordsWithSpace` over its plain text; Q5); a code, Mermaid or front-matter block carries line changes; a table row carries word parts per cell.
- **Time.** The parse comes first; then one 2-second budget (`DIFF_TIMEOUT_MS`) is shared by every jsdiff call of the file, passed as jsdiff's `timeout`. A piece that runs out shows as all removed, then all added; once the budget is spent the rest is compared block by block only.
- **Limits on the Markdown view.** The parser is superlinear on some inputs, so a linear pre-scan (`parseableMarkdown`) sends a file to the plain line view when it has more than 16 container markers opening one line, an indent over 128 columns, `[` nested over 32 deep in a paragraph, a delimiter cost over 4,000,000 (the sum over paragraphs of the count of `*`, `_`, `~`, `[`, `]` squared) or over 1,000 setext underlines. Measured on this repo's 120 Markdown files: at most 6 columns of indent and a cost of 16,283. A parse that throws (200 KB of `>` overflows the stack) also gives the line view. So does a side with more than 5,000 blocks (`MAX_DIFF_BLOCKS`) or blocks carrying more than about 2,000,000 characters (`MAX_DIFF_OUTPUT`). Two identical sides stop early with no blocks, and unchanged blocks carry only their `after`.
- **In a worker thread.** jsdiff and the parse are synchronous, so the app runs each diff in its own worker thread (`workerDiff` in `packages/shell/src/main/diff-runner.ts`, the built `diff-worker.js` entry): a 512 MB heap, killed after 15 s (`DIFF_WORKER_TIMEOUT_MS`). At most 2 run at once (`DIFF_WORKERS_AT_ONCE`) and 8 more wait (`DIFF_WORKERS_WAITING`); one past that answers "failed". When a `.md` diff's worker gives up, main falls back to the plain line view in process with a 250 ms budget (`IN_PROCESS_DIFF_MS`), no parse. Without a worker (tests, a caller that passes none), `inProcessDiff` uses that same small budget.
- **Links.** The history stores a link as its target's path, never what it points to. When the file in the folder, or a folder on its way, is a link, the diff against the current file is refused as `unsafe`.

**In the window** (`packages/ui/src/FileDiff.tsx`), the diff is only drawn:

- Unchanged, added and removed blocks are drawn whole with the reader's `<Markdown>`. A changed block shows its plain text with `<ins>`/`<del>` word marks: bold, links and code spans aren't drawn inside it (Q5). Code and other text files are line tables, highlighted up to 3,000 lines. Long unchanged runs of lines fold to a few lines of context around each change (`aroundChanges`).
- Nothing becomes HTML: diff text is React text nodes in `<ins>`, `<del>` and `<span>`, and colours are `--hh-diff-*` tokens. The CSP is unchanged.
- **Inline or side by side.** Side by side draws inline while the diff's own box is narrower than 900 px, measured with `ResizeObserver` (Q12); the switch keeps the choice for when it widens. Changed cells carry a sign and a hidden "Added"/"Removed", and the columns hidden "Before"/"After" labels, so the colour isn't the only signal.
- **Source** shows the line diff of the raw text. A changed Mermaid fence shows the diagram before and after, with its own Source toggle.

## Going back one file

`client.files.restore(path, commit)`, where `commit` is an entry's `to` (§5):

1. The preload (`restoreFlow` in `packages/shell/src/preload/file-restore.ts`) asks main for the prompt (`hh:fileRestorePrompt`). Main checks the path and that `commit` is the `to` of an entry of this path's timeline; a `deleted` entry is refused.
2. It asks the confirmer the core's chat registered (`files.hostConfirm`). `ChatView` draws `RestoreConfirm` (`role="alertdialog"`, Cancel focused, Esc says no, Tab trapped): "Go back {{file}} to how it was after {{author}} ({{ago}})? The rest of the folder doesn't change." (or "to v{{version}}, the version you approved" for an approval). Without a confirmer, on a no or a throw, nothing goes back: `"cancelled"`. A go-back never happens unconfirmed.
3. Main (`hh:fileRestore`) checks again, then runs `History.restoreFile` through the existing `RestoreGuard`: one at a time, turns held meanwhile.

`History.restoreFile` writes one file with the restore's link checks (`history.md`): `O_NOFOLLOW` where the OS has it, the parent's real path checked before and right after `mkdir`. A path it can't write safely is skipped and the answer is `unsafe`. The commit is `Go back: <path> to <target>`, where `<target>` is `v2` for an approval and `the version of <ISO time>` otherwise. It is untagged, like every restore, and stages only that path, so the person's other uncommitted edits wait for the next commit. The go-back is itself an entry and can be undone the same way.

- Refused with `busy` while a turn or a task operation runs or turns are held (the rule of today's restores; plan Conflicts 1), checked before the confirmation and again after it.
- Content already equal to that version makes no commit; the answer is still `"restored"` (Q9).
- After a go-back main tells the settings, as the other restores do (a `.harness/data/` file may have gone back).
- A reviewed document that goes back becomes stale ("Changed since approval") unless it went back to the approved version. Its record stays as it is.

**Trust (Q4, for Marco to decide).** The confirmation lives in the window. Harness UI code runs in the core's own realm (one bundle, one frame), so a harness could register its own confirmer with `files.hostConfirm(async () => true)` and go back without asking. No in-window fix exists. The same holds already for `hh:restore` and `hh:restoreTask`, which have no confirmation in main at all. Harness code is trusted today; sandboxed plugins are a different boundary. The alternative is a native dialog shown by main: unforgeable, at the cost of the app's look and harder end-to-end tests.

## For harness views

`HarnessClient.files` (`packages/ui/src/client.ts`); every call answers with data, refusals are `FileRefusal`: `not-ready`, `outside`, `untracked`, `bad-input`, `not-found`, `deleted`, `busy`, `unsafe`, `failed`.

- `timeline(path)` → `{ ok: true, entries } | { ok: false, reason }` (plan Conflicts 5).
- `diff(path, from, to)` → `FileDiffView | { ok: false, reason }`; `from` null is "nothing before", `to` a commit or `"current"`. It takes any two commits that are the `from` or `to` of an entry on that path's timeline.
- `restore(path, commit)` → `"restored" | "cancelled" | { refused }`. The core always confirms.
- `onChange(path, listener)`: a commit touched the path (main sends `hh:fileCommits` with each commit's paths).
- `hostConfirm(confirm)`: the core's chat only.

Main checks every path: `refusedShape` first, then inside the person's folder (a `.md` in its canonical spelling) and tracked. Reference folders are never read or written here. Components, which take the client like `MaterialPanel`:

- `<FileTimeline client path selected? onPick? />`: the entry list (read-only without `onPick`), with its chips: "not approved", "v2 approved", "Outside the app", "Deleted".
- `<FileDiff client path from to layout? refresh? />`: the diff, both layouts and the Source toggle. Change `refresh` to fetch the diff again (the file now may have changed).

## In the app

- **The reader** (`DocumentReader.tsx`): "File history" in the header (Q8: the top bar already has "History") toggles a drawer (`<section aria-label="File history">`) right of the document. Picking an entry replaces the text with `EntryDiff`: "What changed here" / "Against the current version", "Inline" / "Side by side", "Go back to this version" and "Back to the document". The review footer bar and the "Comment" button hide while a diff shows. In focus mode the drawer is hidden; the button leaves focus mode and opens it.
- **The History panel** (`HistoryPanel.tsx`): with `onOpenFile`, an open row's changed files are links. An existing `.md` opens in the reader with the drawer (`ReaderTarget.timeline`); any other file, and a deleted `.md`, opens `FileTimelinePanel` (Q10). A `Go back: <path> to …` commit reads "You went back to an earlier version of <path>" (`history.entry.fileBack`).

## "See what changed"

A stale document's "See what changed" (`ApprovedDiff.tsx`, `reviews.md`) is the timeline's diff from the newest approval entry's `to` to the current file, drawn with `<FileDiff>`. It reloads on `files.onChange` and when the reader reads the document again. Answers and approvals appear on the document's timeline.

## D0

The timeline adds no manifest key, no agent tool and no instruction. For every harness and engine, byte for byte:

- the folder: the index lives in the history's git data, outside the folder, and no commit tree ever contains it;
- every commit's subject, trailers and tree: the index is written after the commit, and `restore`, `restoreReport` and `save` stage exactly what they staged before;
- `AGENTS.md` and the engine's instructions file; the `ui`, `data` and `material` MCP servers' tool lists;
- `AppState` (no new field);
- the output of `humanharness run`, which uses the same `History`;
- the History panel without `onOpenFile`: a harness view that renders it gets the old plain paths.

What the person sees that is new (the reader's "File history" button, the History panel's links) is core UI, the same for every harness. The tests that hold this: `packages/workspace/test/history-index.test.ts`, `history-restore-file.test.ts`, `packages/ui/test/history-panel.test.tsx` and the e2e in `packages/e2e/tests/review.spec.ts` (the index only in the app's data folder).

## Known gaps

- **Parallel tasks** don't exist yet (plan Conflicts 1): no per-file wait (a go-back waits for any running turn), no `Job:` author, no partial commits, so a shared path never shows two agents on one entry. `FileTimelineService.restorePrompt` is the one place a per-file check would go.
- **No linked folders** (hatches spec): a path in a reference folder is outside the person's folder and has no history.
- **Renames** start a new timeline; the old path's ends in "Deleted".
- **A crashed turn leaves no trace on a file.** The runtime restores the "Before message" point before any commit of that turn, so neither a task entry nor an `Undo:` entry shows (plan Conflicts 4).
- **Changed blocks drop inline formatting** (Q5): bold, links and code spans show as plain text with word marks.
- **No diff between two arbitrary entries in the UI** yet; `client.files.diff` already takes any two commits on the timeline.
- **The index is written on the commit path.** Every commit rewrites the whole file (see "Cost" above): fine for tens of thousands of commits, slow at 100,000 with many paths. The fix is to write it off the commit path (debounced, not awaited; the in-memory index covers reads; flushed on close).
- **The plain-text fallback is uncapped.** The line view a `.md` falls back to has no output cap: 200 KB of `a\n\n` gives about 7 MB of JSON. Unchanged runs should become counts.
- **The reader's own parse.** The plan-10 reader parses with the same `remark` in the window, without this plan's pre-scan, so an adversarial `.md` can stall the reader's renderer. That predates this plan.
- **"Against the current version" in `EntryDiff`** doesn't pass `refresh`, so it doesn't fetch again after a go-back or an agent's edit while it shows.
- **Focus from the History panel.** Opening a document with the drawer focuses its title, not the drawer, so the first Esc closes the whole reader.
- **Version numbers shift** when older approvals fall outside the 1,000-commit window.

## Where to look

- `packages/workspace/src/subjects.ts` (`ANSWER_PREFIX`, `ANSWER_SEPARATOR`, `APPROVED_PREFIX`, `FILE_RESTORE_PREFIX`), `file-timeline.ts` (`namedPath`, `classifyCommit`, `groupTimeline`), `file-index.ts`, `history.ts` (`tracks`, `onCommit`, `fileCommits`, `fileTimeline`, `readBytesAt`, `restoreFile`), `file-diff.ts`, `safe-read.ts` (`readPrefix`).
- `packages/shell/src/main/file-timeline.ts` (`FileTimelineService`), `file-ipc.ts`, `diff-runner.ts`, `diff-worker.ts`, `index.ts` (wiring, `hh:fileCommits`), `reviews.ts`; `packages/shell/src/preload/file-restore.ts`, `index.ts`.
- `packages/ui/src/client.ts` (`HarnessClient.files`), `FileTimeline.tsx`, `FileDiff.tsx`, `EntryDiff.tsx`, `RestoreConfirm.tsx`, `FileTimelinePanel.tsx`, `ApprovedDiff.tsx`, `DocumentReader.tsx`, `HistoryPanel.tsx`, `ChatView.tsx`, `styles.css`; `packages/i18n/src/locales/en.json` (`timeline.*`).
- Tests: `packages/workspace/test/file-timeline.test.ts`, `file-index.test.ts`, `history-index.test.ts`, `history-timeline.test.ts`, `history-restore-file.test.ts`, `file-diff.test.ts`, `file-diff-markdown.test.ts`, `file-diff-parse-error.test.ts`; `packages/shell/test/file-timeline.test.ts`, `file-ipc.test.ts`, `file-restore.test.ts`; the `packages/ui/test` timeline, diff and reader tests; `packages/e2e/tests/review.spec.ts`.
