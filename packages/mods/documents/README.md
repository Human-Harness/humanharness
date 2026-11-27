# Documents

The main side of the reader, of reviews and of file timelines, and the agent's side of the first two: reads a document
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
  rules; through `ctx.on.agentTools` the tools `ask_in_document`, `read_review` and `reply_comment`, only when the agent
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
