# Folder and history

- The person's folder is visible and theirs. The app prepares it (`prepareFolder` in `packages/workspace/src/folder.ts`), writes the instructions there and keeps its own files under `.harness/`: chats, usage, tasks and notes.
- Every change is recorded in an invisible local git history kept outside the folder (`packages/workspace/src/history.ts`, built on isomorphic-git). Its data lives in the app's data folder, one per folder (`historyDir` in `packages/shell/src/main/config.ts`), so cloud sync never touches it.
- The runtime (`packages/runtime/src/runtime.ts`) commits when it starts ("Start"), before each message ("Before message") and after the turn ("Turn: …", or "Stopped: …" when it didn't finish). If the agent crashes mid-turn, it restores the point before the message. A saved note is committed as "Note: …".
- The history skips `.harness/` except `.harness/notes/`, and skips the generated `AGENTS.md` and the engine's own instructions file.
- History → "Go back to this point" makes the tracked files look as they did then and records that as a new commit, so it can be undone as well. It is refused while a turn runs.
