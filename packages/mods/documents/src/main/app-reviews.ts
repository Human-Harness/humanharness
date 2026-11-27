// The review service over the app's documents calls (`ctx.app.documents`).
import type { DocumentKind } from "@humanharness/harness-sdk";
import type { CoreApp } from "@humanharness/mod-sdk/core";
import { type ReviewDeps, ReviewService } from "./reviews";

/** `changed(path)`: a record changed, so the window draws it again. */
export function appReviews(app: CoreApp["documents"], changed: (path: string) => void): ReviewService {
  return new ReviewService({
    base: async () => (await app.folder())?.base ?? null,
    history: () => app.history() as ReturnType<ReviewDeps["history"]>,
    trailer: () => app.trailer() as ReturnType<ReviewDeps["trailer"]>,
    openTask: () => app.openTask(),
    busy: () => app.busy(),
    whenSettled: (write) => app.whenSettled(write),
    blocked: () => app.blocked(),
    // The canonical path and the record's scope; rejects with `RoundNotStarted` when no turn started.
    round: (r) => app.reviewRound(r),
    approved: (a) => void app.documentApproved(a).catch((err: unknown) => console.error("Could not act on the approval", err)),
    reviewTier: (kind) => {
      const kinds = app.kinds() as Readonly<Record<string, DocumentKind>>;
      return (kind !== undefined && Object.hasOwn(kinds, kind) ? kinds[kind].reviewTier : undefined) ?? "standard";
    },
    changed,
  });
}
