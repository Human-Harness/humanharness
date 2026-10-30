import type { ReviewSummary } from "@humanharness/protocol";
import type { InvokeChannel } from "@humanharness/protocol/channels";
import type { ReviewService } from "./reviews";

export const REVIEW_CHANNELS = [
  "hh:reviewView",
  "hh:reviewSummaries",
  "hh:reviewAnswer",
  "hh:reviewComment",
  "hh:reviewEditDraft",
  "hh:reviewReopen",
  "hh:reviewSend",
  "hh:reviewApprove",
  "hh:reviewApprovedText",
] as const satisfies readonly InvokeChannel[];

export type ReviewChannel = (typeof REVIEW_CHANNELS)[number];

const notReady = { ok: false as const, reason: "not-ready" as const };

/**
 * The `hh:review*` handlers (review spec §5.6). Every answer is data: the service checks every input, and a throw
 * (sync or async) is a bug, logged and answered with the fallback. `allowed` is false for a harness whose agent can't
 * edit the folder (D0): nothing reaches the service, so no record is ever made for it; summaries are all null.
 */
export function reviewHandlers(svc: ReviewService, allowed: () => boolean): Record<ReviewChannel, (...args: unknown[]) => Promise<unknown>> {
  const call = <T>(fn: () => Promise<T>, fallback: T): Promise<T> =>
    allowed()
      ? Promise.resolve()
          .then(fn)
          .catch((err: unknown) => {
            console.error("A review call failed", err);
            return fallback;
          })
      : Promise.resolve(fallback);
  return {
    "hh:reviewView": (file) => call(() => svc.view(file), notReady),
    "hh:reviewSummaries": (paths) => {
      if (!allowed()) return Promise.resolve(Array.isArray(paths) ? paths.map(() => null) : []);
      return call(() => svc.summaries(paths), [] as (ReviewSummary | null)[]);
    },
    "hh:reviewAnswer": (file, id, pick) => call(() => svc.answer(file, id, pick), notReady),
    "hh:reviewComment": (file, input) => call(() => svc.comment(file, input), notReady),
    "hh:reviewEditDraft": (file, id, text) => call(() => svc.editDraft(file, id, text), notReady),
    "hh:reviewReopen": (file, id) => call(() => svc.reopen(file, id), notReady),
    "hh:reviewSend": (file) => call(() => svc.send(file), notReady),
    "hh:reviewApprove": (file, blob, opts) => call(() => svc.approve(file, blob, opts), notReady),
    "hh:reviewApprovedText": (file) => call(() => svc.approvedText(file), notReady),
  };
}
