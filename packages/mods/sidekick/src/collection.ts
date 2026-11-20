import { type Collection, collectionSchema } from "@humanharness/harness-sdk";
import { sidekickRecordSchema } from "./manifest";

/** The reserved collection (spec §6.4): app-wide, keyed by `id`, never seen by the task agent. Not in `dataCollections` (D0). */
export function sidekickCollection(): Collection {
  return collectionSchema.parse({ scoped: false, key: "id", schema: sidekickRecordSchema, agent: "none" });
}
