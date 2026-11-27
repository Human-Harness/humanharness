import { defineMod } from "@humanharness/mod-sdk";
import type { CoreMainCtx } from "@humanharness/mod-sdk/core";
import { documentIpc } from "./main/document-ipc";
import { DocumentSessions } from "./main/document-sessions";
import { DocumentWatchers } from "./main/documents";

export default defineMod({
  id: "documents",
  main(base) {
    const ctx = base as unknown as CoreMainCtx<unknown>;
    // A headless run has no app: there is no folder to read and no window to answer.
    if (!ctx.app) return;
    const { app } = ctx;
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
