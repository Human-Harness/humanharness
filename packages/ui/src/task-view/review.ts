import type { ComposerReviewer, ReviewVerdict } from "../layout/registry";

/** A reviewer's longest wait when it gives none, in seconds (Sidekick's shortest). */
export const DEFAULT_REVIEW_WAIT = 6;

/** The reviewer's wait: its own, or the default. */
export const reviewWait = (reviewer: ComposerReviewer): number | "always" => reviewer.wait ?? DEFAULT_REVIEW_WAIT;

/**
 * Runs a mod's review of `text` within its wait: past the wait, or when it fails or `signal` aborts, the text goes as
 * typed ("send"); only a "hold" in time keeps it. A review past its wait is aborted.
 */
export function runReview(reviewer: ComposerReviewer, text: string, signal: AbortSignal, o: { force: boolean; answer: boolean }): Promise<ReviewVerdict> {
  const own = new AbortController();
  const stop = () => own.abort();
  if (signal.aborted) return Promise.resolve("send");
  signal.addEventListener("abort", stop, { once: true });
  const wait = reviewWait(reviewer);
  return new Promise<ReviewVerdict>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (v: ReviewVerdict) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      own.signal.removeEventListener("abort", aborted);
      resolve(v);
    };
    const aborted = () => done("send");
    own.signal.addEventListener("abort", aborted, { once: true });
    if (wait !== "always") timer = setTimeout(stop, wait * 1000);
    let review: Promise<ReviewVerdict>;
    try {
      review = Promise.resolve(reviewer.review(text, own.signal, o));
    } catch {
      review = Promise.resolve("send");
    }
    review.then(
      (v) => done(!own.signal.aborted && v === "hold" ? "hold" : "send"),
      () => done("send"),
    );
  });
}

/** The reviewer's marks for `draft`; none when it has no `marks` or they throw. */
export function reviewMarks(reviewer: ComposerReviewer, draft: string): readonly (readonly [number, number])[] {
  try {
    return reviewer.marks?.(draft) ?? [];
  } catch {
    return [];
  }
}

/**
 * The answer form's review (InputForm's `review`, `cancelReview`, `reviewWait`) through a mod's reviewer: a hold keeps
 * the form (the mod says why), anything else sends. `busy`: a composer review runs, so the answer goes without one.
 * `run` keeps the review in flight across renders: `cancelReview` (Send now, the form gone) aborts it.
 */
export function answerReview(reviewer: ComposerReviewer, busy: () => boolean, run: { current: AbortController | null }) {
  return {
    review: async (text: string): Promise<{ kind: "send" } | { kind: "card" }> => {
      if (busy()) return { kind: "send" };
      const ctl = new AbortController();
      run.current = ctl;
      const v = await runReview(reviewer, text, ctl.signal, { force: false, answer: true });
      if (run.current === ctl) run.current = null;
      return v === "hold" ? { kind: "card" } : { kind: "send" };
    },
    cancelReview: () => {
      run.current?.abort();
      run.current = null;
    },
    reviewWait: reviewWait(reviewer),
  };
}
