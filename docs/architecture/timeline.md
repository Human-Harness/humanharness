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

Main (`FileTimelineService`) keeps up to 32 timelines per history, each keyed on the path's newest commit, so a commit notice doesn't rebuild one (about 0.7 s at 1,000 commits).

## The index

`packages/workspace/src/file-index.ts`. Which commits touched a path comes from an index, not from walking the log on every read:

- **Where.** `<historyDir>/hh-file-index.json`: inside the history's git data folder, next to git's own files (Q6; the spec named a sibling `file-index.json`). It moves, is set aside and is pruned with the history. It never enters the person's folder or a commit: isomorphic-git ignores files it doesn't know in its data folder.
- **Shape.** `{ "version": 1, "head": "<sha>", "paths": { "<path>": ["<sha>", … oldest first] } }`, written through a temp file and a rename. A file over 256 MiB (`MAX_INDEX_BYTES`), with more than 1,000,000 paths (`MAX_INDEX_PATHS`) or commits on one path (`MAX_PATH_COMMITS`), or with an empty, absolute or NUL-bearing key, is ignored and rebuilt.
- **A commit's paths** are the tracked paths it changed, plus the path its subject names: `Approved: <path>` changes only the review record, but belongs on the document's timeline. Indexing doesn't filter through one `History`'s keep and ignore lists, since every `History` on the same git data shares the file.
- **After each commit** (`History.saveNow` → `committed`) only the index `History` holds in memory advances, in place, and only when the commit's parent is its `head`. The file is written off the commit path: `INDEX_WRITE_DELAY_MS` (1 s) after the last commit, one write for a burst, never awaited by the commit; `History.flush()` writes it at once, and `flushFileIndexes()` flushes every `History` with a pending write. The runtime's `close` flushes its history; the app flushes on quit and before a folder move. A write that fails is logged (quietly when the git data is gone) and never fails a commit; a write that never happens costs a short catch-up on the next read. Then `History.onCommit` listeners get the commit's paths.
- **On read** (`History.fileCommits`), when the index's `head` isn't HEAD (another `History` instance committed, the file was missing, or it was refused), it walks first parents back from HEAD: to the index's `head`, catching up on the commits after it; or, when that head isn't found, down to the first commit, a full rebuild. One walk at a time per `History` (a shared promise, never joined by a read that started after a later commit); the window shows "Loading history…" meanwhile. The index a read caught up or rebuilt becomes the one `History` holds and is written the same delayed way. Reads at HEAD use the in-memory index and never touch the file, so an index file that can't be written costs one rebuild, not one per read.
- **Never a source of truth.** Deleting it costs one rebuild.
- **Cost.** A commit adds its paths to the in-memory lists; nothing is written on its path. Measured with `History.save` on a 300-file folder and an index already loaded: about 76 ms per save whatever the index's size (empty, 10,000 commits × 5 paths, 100,000 × 5, 100,000 × 20, a 92 MB file), where writing it on each commit took 117 ms, 325 ms and 1,239 ms at those sizes. The delayed write itself takes 5 ms at 2.4 MB, 33 ms at 23 MB and 173 ms at 92 MB, once per burst of commits.

## The diff

**In main** (`packages/workspace/src/file-diff.ts`, `diffFile`), so `client.files.diff` is plain IPC for harness views too and the cap applies where the bytes are read. It answers data (`FileDiffView`): `markdown` (blocks plus a line diff of the source), `text` (lines and a language) or `binary` (both sizes). jsdiff 9 (`diff`) does the comparing; the Markdown parse is the reader's (`unified` + `remark-parse` + `remark-gfm`).

- **Binary**: a NUL in the first 8 KB of either side, or an extension in a fixed list (images, audio, video, archives, office files, PDFs, fonts, databases, executables). Shown as "Binary file, no preview" with both sizes.
- **The cut**: each side is cut to its first 200 KB (`MAX_DIFF_BYTES`, backed up to a whole UTF-8 character), with `truncated: true` and a notice. Main reads no more than that of a historical blob or the current file (`History.readBytesAt(sha, file, max)`, `readPrefix`). `same` comes from the blob ids and sizes, never from the cut bytes, so two big files that differ only past the cut aren't "the same".
- **Blocks** (`markdownBlocks`): front-matter (one block), headings, paragraphs, each item of a top-level list (nested lists stay in their item), each table row, code fences, Mermaid fences, callouts and other blockquotes (one block each), thematic breaks and HTML (`other`). `diffMarkdown` aligns them with `diffArrays` on their source. Inside a run of removed-then-added blocks, the i-th removed and the i-th added pair up when they are the same type and become one `changed` block; the rest stay `removed` and `added`. A moved paragraph is a removal plus an addition.
- **Inside a changed block**: a text block carries word parts (`diffWordsWithSpace` over its plain text; Q5); a code, Mermaid or front-matter block carries line changes; a table row carries word parts per cell.
- **Line diffs travel compact.** A whole file's line diff (the `text` view, and a Markdown view's `source`) keeps only its changes and up to 3 unchanged lines around each (`DIFF_CONTEXT_LINES`, the window's own context); every run left out becomes one `gap` line with its `count` (`compactLines`). At most 10,000 lines go out (`MAX_DIFF_LINES`, gaps not counted); past that the rest is cut and the view says `truncated`. So 200 KB of short lines with one change answers a few hundred bytes, not about 7 MB. Lines lose a CRLF's `\r`.
- **Time.** The parse comes first; then one 2-second budget (`DIFF_TIMEOUT_MS`) is shared by every jsdiff call of the file, passed as jsdiff's `timeout`. A piece that runs out shows as all removed, then all added; once the budget is spent the rest is compared block by block only.
- **Limits on the Markdown view.** The parser is superlinear on some inputs, so a linear pre-scan (`parseableMarkdown`) sends a file to the plain line view when it has more than 16 container markers opening one line, an indent over 128 columns, `[` nested over 32 deep in a paragraph, a delimiter cost over 4,000,000 (the sum over paragraphs of the count of `*`, `_`, `~`, `[`, `]` squared) or over 1,000 setext underlines. Measured on this repo's 120 Markdown files: at most 6 columns of indent and a cost of 16,283. A parse that throws (200 KB of `>` overflows the stack) also gives the line view. So does a side with more than 5,000 blocks (`MAX_DIFF_BLOCKS`) or blocks carrying more than about 2,000,000 characters (`MAX_DIFF_OUTPUT`). Two identical sides stop early with no blocks, and unchanged blocks carry only their `after`.
- **In a worker thread.** jsdiff and the parse are synchronous, so the app runs each diff in its own worker thread (`workerDiff` in `packages/shell/src/main/diff-runner.ts`, the built `diff-worker.js` entry): a 512 MB heap, killed after 15 s (`DIFF_WORKER_TIMEOUT_MS`). At most 2 run at once (`DIFF_WORKERS_AT_ONCE`) and 8 more wait (`DIFF_WORKERS_WAITING`); one past that answers "failed". When a `.md` diff's worker gives up, main falls back to the plain line view in process with a 250 ms budget (`IN_PROCESS_DIFF_MS`), no parse. Without a worker (tests, a caller that passes none), `inProcessDiff` uses that same small budget.
- **Links.** The history stores a link as its target's path, never what it points to. When the file in the folder, or a folder on its way, is a link, the diff against the current file is refused as `unsafe`.

**In the window** (`packages/ui/src/FileDiff.tsx`), the diff is only drawn:

- Unchanged, added and removed blocks are drawn whole with the reader's `<Markdown>`. A changed block shows its plain text with `<ins>`/`<del>` word marks: bold, links and code spans aren't drawn inside it (Q5). Code and other text files are line tables, highlighted up to 3,000 lines. Long unchanged runs of lines fold to a few lines of context around each change (`aroundChanges`); a `gap` line main sent is always drawn as a gap, in both layouts.
- Nothing becomes HTML: diff text is React text nodes in `<ins>`, `<del>` and `<span>`, and colours are `--hh-diff-*` tokens. The CSP is unchanged.
- **Inline or side by side.** Side by side draws inline while the diff's own box is narrower than 900 px, measured with `ResizeObserver` (Q12); the switch keeps the choice for when it widens. Changed cells carry a sign and a hidden "Added"/"Removed", and the columns hidden "Before"/"After" labels, so the colour isn't the only signal.
- **Source** shows the line diff of the raw text. A changed Mermaid fence shows the diagram before and after, with its own Source toggle.

## Going back one file

`client.files.restore(path, commit)`, where `commit` is an entry's `to` (§5):

1. The preload (`restoreFlow` in `packages/shell/src/preload/file-restore.ts`) makes one call, `hh:fileRestore`. An invoke that rejects (no handler, a closing window) answers `{ refused: "failed" }`, never a throw.
2. Main (`goBackHandlers` in `packages/shell/src/main/go-back.ts`) asks `FileTimelineService.restorePrompt` first: it checks the path and that `commit` is the `to` of an entry of this path's timeline; a `deleted` entry is refused, and so is a go-back while busy. A refusal asks nothing.
3. Main asks with a **native dialog**, a sheet on the window that asked (`dialog.showMessageBox`; see "Every go-back asks in main" in `history.md`): "Go back to this version?", then "Go back {{file}} to how it was after {{author}} ({{ago}})? The rest of the folder doesn't change." (or "to v{{version}}, the version you approved" for an approval). The buttons are "Go back" and "Cancel"; Cancel is the default and the cancel id. A Cancel, or any failure to ask, answers `{ ok: false, reason: "cancelled" }`, which the client turns into `"cancelled"`; `EntryDiff` treats it quietly, as no change. A go-back never happens unconfirmed.
4. Main (`FileTimelineService.restore`) checks again, then runs `History.restoreFile` through the existing `RestoreGuard`: one at a time, turns held meanwhile.

`History.restoreFile` writes one file with the restore's link checks (`history.md`): `O_NOFOLLOW` where the OS has it, the parent's real path checked before and right after `mkdir`. A file that is a symbolic or hard link to an outside file is replaced, and the outside file never changes; the commit that deleted the file is not a version to go back to. A path it can't write safely is skipped and the answer is `unsafe`. The commit is `Go back: <path> to <target>`, where `<target>` is `v2` for an approval and `the version of <ISO time>` otherwise. It is untagged, like every restore, and stages only that path, so the person's other uncommitted edits wait for the next commit. The go-back is itself an entry and can be undone the same way.

- Refused with `busy` while a turn or a task operation runs or turns are held (the rule of today's restores; plan Conflicts 1), checked before the confirmation and again after it.
- Content already equal to that version makes no commit; the answer is still `"restored"` (Q9).
- After a go-back main tells the settings, as the other restores do (a `.harness/data/` file may have gone back).
- A reviewed document that goes back becomes stale ("Changed since approval") unless it went back to the approved version. Its record stays as it is.

**Trust (Q4, decided by Marco on 2026-10-28).** Harness UI code runs in the core's own realm (one bundle, one frame), so a confirmation drawn in the window could be answered by harness code. The confirmation is therefore main's native dialog, for this go-back and for the whole-folder and task go-backs (`history.md`). Nothing in the window can answer it. The in-window confirmation (`files.hostConfirm`, `RestoreConfirm`) is gone; no harness used it.

## For harness views

`HarnessClient.files` (`packages/ui/src/client.ts`); every call answers with data, refusals are `FileRefusal`: `not-ready`, `outside`, `untracked`, `bad-input`, `not-found`, `deleted`, `busy`, `unsafe`, `failed`.

- `timeline(path)` → `{ ok: true, entries } | { ok: false, reason }` (plan Conflicts 5).
- `diff(path, from, to)` → `FileDiffView | { ok: false, reason }`; `from` null is "nothing before", `to` a commit or `"current"`. It takes any two commits that are the `from` or `to` of an entry on that path's timeline.
- `restore(path, commit)` → `"restored" | "cancelled" | { refused }`. Main always confirms with its native dialog; `"cancelled"` means the person said no.
- `onChange(path, listener)`: a commit touched the path. Main sends `hh:fileCommits` with each commit's paths, or null for a commit that changed more than 200 (`MAX_ANNOUNCED_PATHS`, a big `Start`): then every watched path hears it. The preload keeps one ipc listener for all of them (`fileCommitListeners`).

Main checks every path: `refusedShape` first, then inside the person's folder (a `.md` in its canonical spelling) and tracked. Reference folders are never read or written here. Components, which take the client like `MaterialPanel`:

- `<FileTimeline client path selected? onPick? />`: the entry list (read-only without `onPick`), with its chips: "not approved", "v2 approved", "Outside the app", "Deleted".
- `<FileDiff client path from to layout? refresh? />`: the diff, both layouts and the Source toggle. Change `refresh` to fetch the diff again (the file now may have changed).

## In the app

- **The reader** (`DocumentReader.tsx`): "File history" in the header (Q8: the top bar already has "History") toggles a drawer (`<section aria-label="File history">`) right of the document. Picking an entry replaces the text with `EntryDiff`: "What changed here" / "Against the current version", "Inline" / "Side by side", "Go back to this version" and "Back to the document". "Against the current version" asks again after a commit to the file and when the reader reads the text again (`EntryDiff`'s `refresh`). The review footer bar and the "Comment" button hide while a diff shows. Back from a diff, the document returns to the place it had (its heading at the top when the diff opened) and its review marks are drawn again; focus that was in the diff (or nowhere) goes to the entry, focus the person put elsewhere stays. In focus mode the drawer is hidden; the button leaves focus mode and opens it. A narrow reader gets a 220 px drawer.
- **The History panel** (`HistoryPanel.tsx`): with `onOpenFile`, an open row's changed files are links. An existing `.md` opens in the reader with the drawer (`ReaderTarget.timeline`, exactly `true`) and focus in the drawer, so the first Esc closes the drawer, not the reader; any other file, and a deleted `.md`, opens `FileTimelinePanel` (Q10). Each link's description is the change's kind ("Changed", "Deleted"…). Opening the reader closes the timeline panel, which would cover it. A `Go back: <path> to …` commit reads "You went back to an earlier version of <path>" (`history.entry.fileBack`).

## "See what changed"

A stale document's "See what changed" (`ApprovedDiff.tsx`, `reviews.md`) is the timeline's diff from the `lastApproved` entry's `to` (the approval the review record holds last, paired by blob) to the current file, drawn with `<FileDiff>`. That is not always the newest approval entry: after a whole-folder go-back between v1 and v2, the record holds v1 again, and so does "See what changed". With no paired entry it says there is nothing to compare. It reloads on `files.onChange` and when the reader reads the text again; a reload that fails keeps the approval it had. Answers and approvals appear on the document's timeline. `client.documents.approvedText` (`hh:reviewApprovedText`), which "See what changed" used before, stays as public harness API though the core no longer calls it.

## D0

The timeline adds no manifest key, no agent tool and no instruction. For every harness and engine, byte for byte:

- the folder: the index lives in the history's git data, outside the folder, and no commit tree ever contains it;
- every commit's subject, trailers and tree: the index is written after the commit, off its path, and `restore`, `restoreReport` and `save` stage exactly what they staged before;
- `AGENTS.md` and the engine's instructions file; the `ui`, `data` and `material` MCP servers' tool lists;
- `AppState` (no new field);
- the output of `humanharness run`, which uses the same `History`;
- the History panel without `onOpenFile`: a harness view that renders it gets the old plain paths.

What the person sees that is new (the reader's "File history" button, the History panel's links) is core UI, the same for every harness. The tests that hold this: `packages/workspace/test/history-index.test.ts`, `history-restore-file.test.ts`, `packages/ui/test/history-panel.test.tsx` and the e2e in `packages/e2e/tests/review.spec.ts` (the index only in the app's data folder).

## Known gaps

- **Parallel tasks** don't exist yet (plan Conflicts 1): no per-file wait (a go-back waits for any running turn), no `Job:` author, no partial commits, so a shared path never shows two agents on one entry. `FileTimelineService.restorePrompt` is the one place a per-file check would go.
- **Reference folders have no history**: a path in a reference folder is outside the person's folder.
- **Linked folders have no timeline.** A tracked linked folder has its own core history (`hatches.md`), but the timeline and its index cover only the main folder: its files show no timeline, and the "not covered" line shows only in the History panel (spec §3.4 names both).
- **Renames** start a new timeline; the old path's ends in "Deleted".
- **A crashed turn leaves no trace on a file.** The runtime restores the "Before message" point before any commit of that turn, so neither a task entry nor an `Undo:` entry shows (plan Conflicts 4).
- **Changed blocks drop inline formatting** (Q5): bold, links and code spans show as plain text with word marks.
- **No diff between two arbitrary entries in the UI** yet; `client.files.diff` already takes any two commits on the timeline.
- **The delayed index write blocks main once per burst.** Serialising a 92 MB index takes about 170 ms on Electron main, a second after the last commit of a burst. Smaller indexes take a few ms.
- **The reader's own parse.** The plan-10 reader parses with the same `remark` in the window, without this plan's pre-scan, so an adversarial `.md` can stall the reader's renderer. That predates this plan.
- **Version numbers shift** when older approvals fall outside the 1,000-commit window, and an approval older than that window can't be paired: "See what changed" then says there is nothing to compare.
- **The native dialog's look.** It is the system's, not the app's, and its text is the core's in the person's language (the cached translation, else English).
- **A path whose subject reads short.** `namedPath` cuts an answer's path at the first " · ", so the index lists a shorter path that doesn't exist for a document whose name holds it. The document's own timeline is right (`classifyCommit` matches the whole path).

## Where to look

- `packages/workspace/src/subjects.ts` (`ANSWER_PREFIX`, `ANSWER_SEPARATOR`, `APPROVED_PREFIX`, `FILE_RESTORE_PREFIX`), `file-timeline.ts` (`namedPath`, `classifyCommit`, `groupTimeline`), `file-index.ts`, `history.ts` (`tracks`, `onCommit`, `fileCommits`, `fileTimeline`, `readBytesAt`, `restoreFile`), `file-diff.ts`, `safe-read.ts` (`readPrefix`).
- `packages/shell/src/main/file-timeline.ts` (`FileTimelineService`), `file-ipc.ts`, `go-back.ts` (`hh:fileRestore` and its native dialog), `diff-runner.ts`, `diff-worker.ts`, `index.ts` (wiring, `hh:fileCommits`), `reviews.ts`; `packages/shell/src/preload/file-restore.ts`, `file-commits.ts`, `index.ts`.
- `packages/ui/src/client.ts` (`HarnessClient.files`), `FileTimeline.tsx`, `FileDiff.tsx`, `EntryDiff.tsx`, `FileTimelinePanel.tsx`, `ApprovedDiff.tsx`, `DocumentReader.tsx`, `HistoryPanel.tsx`, `ChatView.tsx`, `styles.css`; `packages/i18n/src/locales/en.json` (`timeline.*`).
- Tests: `packages/workspace/test/file-timeline.test.ts`, `file-index.test.ts`, `history-index.test.ts`, `history-timeline.test.ts`, `history-restore-file.test.ts`, `file-diff.test.ts`, `file-diff-markdown.test.ts`, `file-diff-parse-error.test.ts`; `packages/shell/test/file-timeline.test.ts`, `file-ipc.test.ts`, `file-restore.test.ts`, `go-back.test.ts`, `file-commits.test.ts`; the `packages/ui/test` timeline, diff and reader tests; `packages/e2e/tests/review.spec.ts`.
