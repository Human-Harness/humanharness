import type { ScopesView } from "@humanharness/protocol";
import { type ScopeStore, isScopeId } from "@humanharness/workspace";
import type { LinkedInstructions, ScopeAccess } from "./scope-access";
import type { TaskManager } from "./task-manager";

export interface ScopesIpcDeps {
  quitting(): boolean;
  /** Why a new turn can't start now, or null. */
  turnBlocked(): string | null;
  /** The open task(s): a TaskManager, or board mode's TaskBoard. */
  tasks(): Pick<TaskManager, "currentScope" | "switchScope">;
  scopesView(): Promise<ScopesView>;
  scopesSettled(): Promise<void>;
  scopeStore(): Promise<ScopeStore>;
  scopesChanged(): Promise<void>;
  /** The linked folders' parts, or null without them. */
  linked_(): { access: ScopeAccess; instructions: LinkedInstructions } | null;
}

/** The `hh:scope*` channels (scopes spec §3). */
export function scopesIpc(d: ScopesIpcDeps) {
  const { turnBlocked, scopesView, scopesSettled, scopeStore, scopesChanged, linked_ } = d;
  return {
    "hh:scopes": async () => (await scopesView()).list,
    "hh:scopeCurrent": async () => {
      await scopesSettled();
      return d.tasks().currentScope();
    },
    "hh:scopeCreate": async (title: unknown) => {
      const created = await (await scopeStore()).create(title);
      await scopesChanged();
      return created;
    },
    "hh:scopeRename": async (id: unknown, title: unknown) => {
      if (!isScopeId(id)) throw new Error("Unknown scope");
      const renamed = await (await scopeStore()).rename(id, title);
      await scopesChanged();
      return renamed;
    },
    // A scope is never deleted (spec §3.4). Archiving the open one closes its task and the scope first.
    "hh:scopeArchive": async (id: unknown, archived: unknown) => {
      if (d.quitting()) throw new Error("The app is closing");
      if (!isScopeId(id) || typeof archived !== "boolean") throw new Error("Invalid scope change");
      const store = await scopeStore();
      const closeIfOpen = async () => {
        if ((await d.tasks().currentScope()) !== id) return;
        const blocked = turnBlocked();
        if (blocked) throw new Error(blocked);
        if (!(await d.tasks().switchScope(null))) throw new Error("The open task is still closing");
      };
      if (archived) await closeIfOpen();
      await store.setArchived(id, archived);
      // It may have been opened while the close ran (the scope was not archived yet): close it again.
      if (archived) await closeIfOpen();
      await scopesChanged();
    },
    "hh:scopeOpen": async (id: unknown) => {
      if (d.quitting()) throw new Error("The app is closing");
      const blocked = turnBlocked();
      if (blocked) throw new Error(blocked);
      if (id !== null && !isScopeId(id)) throw new Error("Unknown scope");
      const opened = await d.tasks().switchScope(id);
      await scopesChanged();
      // Linked folders: a folder that gained or lost git is marked (Decision 13); AGENTS.md lists the new scope's folders.
      const linked = linked_();
      if (linked && opened) {
        void (async () => {
          if (id !== null) await linked.access.checkGit(id).catch((err: unknown) => console.error("Could not check the linked folders' git", err));
          await linked.instructions.changed();
        })();
      }
      return opened;
    },
  };
}
