import { defineMod } from "@humanharness/mod-sdk";
import type { CoreAgentInfo, CoreMainCtx } from "@humanharness/mod-sdk/core";
import { ReviewLocks, runReviewRequest } from "@humanharness/workspace";
import { documentsAgent } from "./main/agent";
import { appFileTimeline } from "./main/app-file-timeline";
import { documentIpc } from "./main/document-ipc";
import { DocumentSessions } from "./main/document-sessions";
import { DocumentWatchers } from "./main/documents";
import { fileHandlers } from "./main/file-ipc";
import type { FileTimelineDeps } from "./main/file-timeline";
import { appReviews } from "./main/app-reviews";
import { reviewHandlers } from "./main/review-ipc";

export default defineMod({
  id: "documents",
  main(base) {
    const ctx = base as unknown as CoreMainCtx<unknown>;
    // The agent's tools in a headless run: the folder its runtime works in, under one set of locks.
    const locks = new ReviewLocks();
    const task = async () => {
      const t = await ctx.tasks.running();
      return t ? { id: t.id, scope: t.scope } : null;
    };
    let review = (folder: string, request: unknown): Promise<unknown> => runReviewRequest({ base: folder, locks, task }, request);
    // In the app and in `humanharness run` alike (the CLI loads the mods for these two hooks).
    const agent = documentsAgent((folder, request) => review(folder, request));
    ctx.on.instructions?.((info) => agent.instructions(info as CoreAgentInfo));
    ctx.on.agentTools?.((info) => agent.agentTools(info as CoreAgentInfo));
    // A headless run has no app: there is no folder to read and no window to answer.
    if (!ctx.app) return;
    const { app } = ctx;
    // The person's side of reviews. The agent's tools go through the same service, so both sides share its locks.
    const reviews = appReviews(app.documents, (path) => ctx.push("hh:reviewChanged", path));
    review = (folder, request) => reviews.agent(folder, request);
    for (const [channel, handler] of Object.entries(reviewHandlers(reviews, () => app.documents.canEdit()))) ctx.handle(channel as `hh:${string}`, handler);
    // The file timeline: its reads are the mod's. A one-file go-back is confirmed by the core, which asks on the window
    // that asked and, only after a yes, hands the service the restore guard to write through.
    const timeline = appFileTimeline(app.documents);
    for (const [channel, handler] of Object.entries(fileHandlers(timeline))) ctx.handle(channel as `hh:${string}`, handler);
    ctx.handleFrom("hh:fileRestore", (sender, file, commit) =>
      app.history.restoreFile(sender, file, commit, {
        restorePrompt: (f, c) => timeline.restorePrompt(f, c),
        restore: (f, c, guard) => timeline.restore(f, c, guard as FileTimelineDeps["restore"]),
      }),
    );
    // Each commit's paths (null: refresh them all), so an open timeline gets its new entry.
    ctx.on.historyCommit((paths) => ctx.push("hh:fileCommits", paths));
    // The reader's open documents (document-reader spec §5.3), by window: the window that asked for a watch hears when
    // its document changes, and when a watch ends without it asking, so it watches again.
    const sessions: DocumentSessions = new DocumentSessions(
      new DocumentWatchers((id) => {
        if (sessions.ownerOf(id) !== null) ctx.push("hh:documentChanged", id);
      }),
      (_owner, id) => ctx.push("hh:documentWatchEnded", id),
    );
    // Where documents and images may be read: the person's folder and the reference folders; null before setup.
    const reader = documentIpc({ documentRoots: async () => (await app.documents.folder())?.roots() ?? null, documentSessions: sessions });
    ctx.handle("hh:readDocument", reader["hh:readDocument"]);
    ctx.handle("hh:readImage", reader["hh:readImage"]);
    ctx.handle("hh:documentsExist", reader["hh:documentsExist"]);
    ctx.handleFrom("hh:watchDocument", reader["hh:watchDocument"]);
    ctx.handleFrom("hh:unwatchDocument", reader["hh:unwatchDocument"]);
    ctx.on.windowClosed((senderId) => sessions.closeOwner(senderId));
    // A watch never outlives the folder it was checked against, nor the mod.
    ctx.on.folderChanged(() => sessions.closeAll());
    ctx.on.dispose?.(() => sessions.closeAll());
  },
});
