// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewResult, ReviewSummary } from "../src/client";
import { ReviewBar } from "../src/ReviewBar";
import { renderIn } from "./render";

afterEach(cleanup);
const S = (over: Partial<ReviewSummary> = {}): ReviewSummary => ({ status: "draft", questions: 0, blocking: 0, unsent: 0, comments: 0, ...over });

async function setup(summary: ReviewSummary, over = {}) {
  const props = {
    summary,
    busy: false,
    onSend: vi.fn(async () => ({ ok: true as const, sent: 1, to: "open" as const })),
    onApprove: vi.fn(async (): Promise<ReviewResult> => ({ ok: true })),
    onSeeChanges: vi.fn(),
    ...over,
  };
  await renderIn("en", <ReviewBar {...props} />);
  return props;
}

describe("ReviewBar (§5.3, §5.4)", () => {
  it("counts what the batch carries; disabled while a turn runs", async () => {
    await setup(S({ unsent: 2 }), { busy: true });
    const send = screen.getByRole("button", { name: "Send comments (2)" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });

  it("sending says where the round went", async () => {
    const p = await setup(S({ unsent: 1 }), { onSend: vi.fn(async () => ({ ok: true as const, sent: 1, to: "new" as const })) });
    fireEvent.click(screen.getByRole("button", { name: "Send comment (1)" }));
    expect(await screen.findByText("Sent: a review task started.")).toBeTruthy();
    expect(p.onSend).toHaveBeenCalled();
  });

  it("approves at once with nothing open", async () => {
    const p = await setup(S());
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(p.onApprove).toHaveBeenCalledWith(undefined, undefined);
  });

  it("with a blocking question it says so, and approving asks for a reason", async () => {
    const p = await setup(S({ questions: 1, blocking: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "Approve · 1 blocking open" }));
    expect(p.onApprove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Approve anyway, with a reason" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Why approve with blocking questions open?" }), { target: { value: "Decided on the call" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(p.onApprove).toHaveBeenCalledWith("Decided on the call", undefined);
  });

  it("with unsent items it offers 'Send first' and 'Discard and approve'", async () => {
    const p = await setup(S({ unsent: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("1 comment or answer is not sent yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send first" }));
    expect(p.onSend).toHaveBeenCalled();
    cleanup();
    const q = await setup(S({ unsent: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard and approve" }));
    expect(q.onApprove).toHaveBeenCalledWith(undefined, { discard: true });
  });

  it("unsent items and a blocking question: 'Discard and approve' asks the reason once and sends both", async () => {
    const p = await setup(S({ unsent: 1, questions: 1, blocking: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "Approve · 1 blocking open" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard and approve" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve anyway, with a reason" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Why approve with blocking questions open?" }), { target: { value: "Decided" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(p.onApprove).toHaveBeenCalledTimes(1);
    expect(p.onApprove).toHaveBeenCalledWith("Decided", { discard: true });
  });

  it("a 'reason-required' answer to a discard keeps the discard with the reason", async () => {
    const onApprove = vi.fn(async (_r?: string, o?: { discard?: boolean }): Promise<ReviewResult> => (o?.discard && _r === undefined ? { ok: false, reason: "reason-required" } : { ok: true }));
    await setup(S({ unsent: 1 }), { onApprove });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard and approve" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve anyway, with a reason" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Why approve with blocking questions open?" }), { target: { value: "Decided" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApprove).toHaveBeenLastCalledWith("Decided", { discard: true });
  });

  it("Esc closes its own prompt, not what holds the bar, and focus goes back to Approve", async () => {
    const outer = vi.fn();
    const p = { summary: S({ unsent: 1 }), busy: false, onSend: vi.fn(), onApprove: vi.fn(), onSeeChanges: vi.fn() };
    await renderIn(
      "en",
      <div onKeyDown={outer}>
        <ReviewBar {...p} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Send first" }), { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Send first" })).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Approve" }));
    // Nothing open: Esc goes on to the reader (it closes the reader, or leaves focus mode).
    fireEvent.keyDown(screen.getByRole("button", { name: "Approve" }), { key: "Escape" });
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it("the status line is one live region, there before anything is said", async () => {
    await setup(S({ unsent: 1 }));
    expect(screen.getByRole("status").textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Send comment (1)" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Sent to the task."));
  });

  it("a document changed since it was read is not approved, and says so", async () => {
    await setup(S(), { onApprove: vi.fn(async (): Promise<ReviewResult> => ({ ok: false, reason: "changed" })) });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("The document changed while you read it. Read it again, then approve.")).toBeTruthy();
  });

  it("approved shows the time and the reason; stale shows the change and 'See what changed'", async () => {
    await setup(S({ status: "approved", approvedAt: "2026-10-28T10:00:00.000Z" }), { approvedReason: "Decided on the call" });
    expect(screen.getByText(/^Approved · /)).toBeTruthy();
    expect(screen.getByText("Approved with a reason: Decided on the call")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    cleanup();
    const p = await setup(S({ status: "stale", approvedAt: "2026-10-28T10:00:00.000Z" }));
    expect(screen.getByText("Changed since approval")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "See what changed" }));
    expect(p.onSeeChanges).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  });
});
