import type { DocumentRead } from "@humanharness/protocol";
import type { WebContents } from "electron";
import { MAX_EXIST_PATHS, documentsExist, readDocument, readImage } from "./documents";

export interface DocumentIpcDeps {
  /** The folder and the reference folders the reader may read, or null when the app is not set up. */
  documentRoots(): Promise<string[] | null>;
  documentSessions: {
    watch(owner: number, rel: unknown, roots: string[]): Promise<number | null>;
    unwatch(owner: number, id: unknown): void;
  };
}

/**
 * The reader (document-reader spec §5.3): it only ever reads, inside the folder or a reference folder. Every input
 * is untrusted (documents.ts checks its shape first) and every failure is an answer, never a thrown error.
 */
export function documentIpc(d: DocumentIpcDeps) {
  const { documentRoots, documentSessions } = d;
  return {
    "hh:readDocument": async (rel: unknown): Promise<DocumentRead> => {
      try {
        const roots = await documentRoots();
        if (!roots) return { ok: false, reason: "not-ready" };
        return await readDocument(rel, roots);
      } catch (err) {
        console.error("Could not read the document", err);
        return { ok: false, reason: "missing" };
      }
    },
    "hh:readImage": async (rel: unknown): Promise<string | null> => {
      try {
        const roots = await documentRoots();
        return roots ? await readImage(rel, roots) : null;
      } catch {
        return null;
      }
    },
    "hh:documentsExist": async (paths: unknown): Promise<boolean[]> => {
      if (!Array.isArray(paths)) return [];
      // Too many to check: none counts as there (one answer per path, as the window expects).
      if (paths.length > MAX_EXIST_PATHS) return paths.map(() => false);
      try {
        const roots = await documentRoots();
        return roots ? await documentsExist(paths, roots) : paths.map(() => false);
      } catch {
        return paths.map(() => false);
      }
    },
    "hh:watchDocument": async (sender: WebContents, rel: unknown): Promise<number | null> => {
      try {
        const roots = await documentRoots();
        return roots ? await documentSessions.watch(sender.id, rel, roots) : null;
      } catch {
        return null;
      }
    },
    "hh:unwatchDocument": (sender: WebContents, id: unknown) => documentSessions.unwatch(sender.id, id),
  };
}
