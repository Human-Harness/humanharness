# Documents

The reader's main side: reads a document or an image inside the person's folder or a reference folder, says which paths
exist, and watches the open document.

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
- `src/ui.ts`: registers nothing yet; the reader is still drawn by `@humanharness/ui`.
- With the mod off, the app answers each channel as its caller already handles it (`mods/app-channels.ts` in the shell):
  `not-ready` for a read, null for an image or a watch, false for every path.
- With no app (a headless run), the main registers nothing.
