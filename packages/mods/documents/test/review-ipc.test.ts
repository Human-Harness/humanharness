import { describe, expect, it, vi } from "vitest";
import { REVIEW_CHANNELS, reviewHandlers } from "../src/main/review-ipc";
import type { ReviewService } from "../src/main/reviews";

function fakeService() {
  const calls: string[] = [];
  const ok = (op: string) => async () => (calls.push(op), { ok: true as const });
  const svc = {
    view: ok("view"),
    summaries: async (paths: unknown) => (calls.push("summaries"), (paths as string[]).map(() => ({ status: "draft" }))),
    answer: ok("answer"),
    comment: ok("comment"),
    editDraft: ok("editDraft"),
    reopen: ok("reopen"),
    send: ok("send"),
    approve: ok("approve"),
    approvedText: ok("approvedText"),
  } as unknown as ReviewService;
  return { svc, calls };
}

describe("review IPC handlers (review spec D0)", () => {
  it("a harness whose agent can't edit the folder: every call answers not-ready and never reaches the service", async () => {
    const { svc, calls } = fakeService();
    const h = reviewHandlers(svc, () => false);
    expect(Object.keys(h).sort()).toEqual([...REVIEW_CHANNELS].sort());
    for (const channel of REVIEW_CHANNELS) {
      if (channel === "hh:reviewSummaries") continue;
      expect(await h[channel]("specs/a.md", "c1", 0)).toEqual({ ok: false, reason: "not-ready" });
    }
    expect(await h["hh:reviewSummaries"](["a.md", "b.md"])).toEqual([null, null]);
    expect(await h["hh:reviewSummaries"]("nope")).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("with the folder editable: forwards; a throw, sync or async, becomes the fallback", async () => {
    const { svc, calls } = fakeService();
    const h = reviewHandlers(svc, () => true);
    expect(await h["hh:reviewApprove"]("a.md", "b".repeat(40), {})).toEqual({ ok: true });
    expect(await h["hh:reviewSummaries"](["a.md"])).toEqual([{ status: "draft" }]);
    expect(calls).toEqual(["approve", "summaries"]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    (svc as unknown as { view: () => never }).view = () => {
      throw new Error("sync");
    };
    (svc as unknown as { send: () => Promise<never> }).send = async () => Promise.reject(new Error("async"));
    (svc as unknown as { summaries: () => never }).summaries = () => {
      throw new Error("sync");
    };
    expect(await h["hh:reviewView"]("a.md")).toEqual({ ok: false, reason: "not-ready" });
    expect(await h["hh:reviewSend"]("a.md")).toEqual({ ok: false, reason: "not-ready" });
    expect(await h["hh:reviewSummaries"](["a.md"])).toEqual([]);
    expect(error).toHaveBeenCalledTimes(3);
    error.mockRestore();
  });
});
