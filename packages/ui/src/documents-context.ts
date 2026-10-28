import { createContext } from "react";
import type { DocumentKind } from "@humanharness/harness-sdk/documents";

/** What Markdown needs from the window to open documents and read images (document-reader spec §3.4, §5.1). */
export interface DocumentHost {
  /** Opens a document (a path inside the folder) in the reader, at `anchor` when given. */
  open(path: string, anchor?: string): void;
  /** A local image as a data: URL; null when refused or missing. */
  image(path: string): Promise<string | null>;
  /** The harness's document kinds (manifest `documents.kinds`); absent without them (D0). */
  kinds?: Record<string, DocumentKind>;
}

/** Null outside the chat: `.md` links are plain text and local images show their alt text. */
export const DocumentContext = createContext<DocumentHost | null>(null);
