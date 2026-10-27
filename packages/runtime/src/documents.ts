import { isMarkdownPath, refusedShape, summarizeDocument } from "@humanharness/harness-sdk";
import type { History } from "@humanharness/workspace";
import type { DocumentCard } from "./events";

/** At most this many cards per turn. */
export const MAX_CARDS = 20;
/** A card reads at most this much of a document (characters): its title, kind and word count come from this part. */
export const MAX_CARD_TEXT = 1024 * 1024;

/**
 * The cards of a turn (document-reader spec §5.1): every `.md` added or changed between the turn's "Before message"
 * commit and its "Turn: …" commit, read at the turn's commit. Never the app's files under `.harness/`, nor a path the
 * reader would refuse to open. Past `MAX_CARD_TEXT` the word count is a floor.
 */
export async function turnDocuments(history: Pick<History, "changes" | "readFileAt">, before: string, after: string): Promise<DocumentCard[]> {
  const picked = (await history.changes(before, after))
    .filter((c) => c.kind !== "deleted" && isMarkdownPath(c.path) && !c.path.startsWith(".harness/") && !refusedShape(c.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, MAX_CARDS);
  const cards: DocumentCard[] = [];
  for (const c of picked) {
    const text = await history.readFileAt(after, c.path);
    if (text === null) continue;
    cards.push({ path: c.path, ...summarizeDocument(c.path, text.slice(0, MAX_CARD_TEXT)), change: c.kind === "added" ? "new" : "updated" });
  }
  return cards;
}
