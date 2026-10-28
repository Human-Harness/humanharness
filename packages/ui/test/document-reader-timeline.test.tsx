// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineEntry } from "../src/client";
import { DocumentReader } from "../src/DocumentReader";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

/** Every text box the reader looked for review marks in. */
const marksFound = vi.hoisted(() => ({ boxes: [] as HTMLElement[] }));
vi.mock("../src/review-marks", async (original) => {
  const m = await original<typeof import("../src/review-marks")>();
  return {
    ...m,
    findMarks: (box: HTMLElement, marks: Parameters<typeof m.findMarks>[1]) => {
      marksFound.boxes.push(box);
      return m.findMarks(box, marks);
    },
  };
});

const DOC = "docs/cache.md";
const A = "a".repeat(40);
const B = "b".repeat(40);
const entry: TimelineEntry = {
  kind: "task",
  author: { kind: "agent", label: "Spec writer", task: "t1", action: "spec" },
  label: "1 change",
  at: "2026-10-28T10:00:00.000Z",
  from: A,
  to: B,
  commits: [{ id: B, subject: "Turn: write", at: "2026-10-28T10:00:00.000Z" }],
};

function setup(over: Partial<Parameters<typeof DocumentReader>[0]> = {}, text = "## Context\n\nSlow calls.\n") {
  const client = new FakeClient();
  client.docTexts[DOC] = text;
  client.timelines[DOC] = [entry];
  client.diffs[`${DOC}|${A}|${B}`] = { ok: true, kind: "markdown", same: false, truncated: false, blocks: [{ type: "paragraph", status: "added", after: "Slow calls." }], source: [] };
  const props = { client, target: { path: DOC }, prefs: {}, onPrefs: vi.fn(), full: false, onFull: vi.fn(), onClose: vi.fn(), onOpen: vi.fn(), ...over };
  return { client, props, view: renderIn("en", <DocumentReader {...props} />) };
}

const reader = () => screen.getByRole("complementary");

describe("the reader's file history (file-timeline spec §6.1)", () => {
  it("the button opens the drawer; picking an entry shows its diff in place of the document; back returns", async () => {
    setup();
    await screen.findByText("Slow calls.");
    expect(screen.queryByRole("region", { name: "File history" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "File history" }));
    const drawer = screen.getByRole("region", { name: "File history" });
    fireEvent.click(await within(drawer).findByRole("button", { name: /Spec writer/ }));
    const diff = await screen.findByRole("region", { name: "Changes" });
    expect(diff.querySelector(".hh-filediff-added")?.textContent).toContain("Slow calls.");
    expect(document.querySelector(".hh-reader-doc")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to the document" }));
    expect(screen.queryByRole("region", { name: "Changes" })).toBeNull();
    expect(await screen.findByText("Slow calls.")).toBeTruthy();
    // Focus goes back to the entry it came from, never lost to the page.
    expect(document.activeElement?.textContent).toContain("Spec writer");
  });

  it("opens with the drawer when the target asks (the History panel's link)", async () => {
    setup({ target: { path: DOC, timeline: true } });
    expect(await screen.findByRole("region", { name: "File history" })).toBeTruthy();
  });

  it("without the drawer, nothing in the reader changes but the button (D0, no layout shift)", async () => {
    setup();
    await screen.findByText("Slow calls.");
    expect(document.querySelector(".hh-timeline-drawer")).toBeNull();
    expect(document.querySelectorAll(".hh-reader-columns > *").length).toBe(2);
  });

  it("focus mode hides the drawer; the button leaves focus mode and opens it", async () => {
    const onFocus = vi.fn();
    setup({ review: true, focus: true, onFocus, target: { path: DOC, timeline: true } });
    await screen.findByText("Slow calls.");
    expect(screen.queryByRole("region", { name: "File history" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "File history" }));
    expect(onFocus).toHaveBeenCalledWith(false);
  });

  it("the review footer bar is hidden while a diff shows", async () => {
    setup({ review: true, target: { path: DOC, timeline: true } });
    await screen.findByRole("button", { name: "Approve" });
    fireEvent.click(await screen.findByRole("button", { name: /Spec writer/ }));
    await screen.findByRole("region", { name: "Changes" });
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("Esc leaves the diff first, then closes the drawer when focus is in it, then closes the reader", async () => {
    const onClose = vi.fn();
    setup({ onClose, target: { path: DOC, timeline: true } });
    const pick = await screen.findByRole("button", { name: /Spec writer/ });
    fireEvent.click(pick);
    await screen.findByRole("region", { name: "Changes" });
    pick.focus();
    fireEvent.keyDown(reader(), { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Changes" })).toBeNull();
    expect(screen.getByRole("region", { name: "File history" })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement ?? reader(), { key: "Escape" });
    expect(screen.queryByRole("region", { name: "File history" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "File history" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(reader(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("with the drawer open and focus in the text, Esc still closes the reader", async () => {
    const onClose = vi.fn();
    setup({ onClose, target: { path: DOC, timeline: true } });
    await screen.findByText("Slow calls.");
    document.querySelector<HTMLElement>(".hh-reader-scroll")!.focus();
    fireEvent.keyDown(screen.getByText("Slow calls."), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opened with the drawer (the History panel's link), focus is in the drawer: the first Esc closes it, not the reader", async () => {
    const onClose = vi.fn();
    setup({ onClose, target: { path: DOC, timeline: true } });
    await screen.findByText("Slow calls.");
    const drawer = screen.getByRole("region", { name: "File history" });
    expect(drawer.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "File history" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("only timeline: true opens the drawer", async () => {
    setup({ target: { path: DOC, timeline: "yes" as unknown as true } });
    await screen.findByText("Slow calls.");
    expect(screen.queryByRole("region", { name: "File history" })).toBeNull();
  });

  it("focus on 'Back to the document' goes back to the entry it came from", async () => {
    setup({ target: { path: DOC, timeline: true } });
    fireEvent.click(await screen.findByRole("button", { name: /Spec writer/ }));
    await screen.findByRole("region", { name: "Changes" });
    const back = screen.getByRole("button", { name: "Back to the document" });
    back.focus();
    fireEvent.click(back);
    await screen.findByText("Slow calls.");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Spec writer/ }));
  });

  it("Esc on a diff leaves focus where the person put it outside the diff", async () => {
    setup({ target: { path: DOC, timeline: true } });
    fireEvent.click(await screen.findByRole("button", { name: /Spec writer/ }));
    await screen.findByRole("region", { name: "Changes" });
    const elsewhere = screen.getByRole("button", { name: "File history" });
    elsewhere.focus();
    fireEvent.keyDown(elsewhere, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Changes" })).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });

  it("back from a diff, the document returns to the place it had, not to a heading of the diff", async () => {
    const { client } = setup({ target: { path: DOC, timeline: true } }, "## Context\n\nSlow calls.\n\n## Plan\n\nCache it.\n");
    client.diffs[`${DOC}|${A}|${B}`] = { ok: true, kind: "markdown", same: false, truncated: false, blocks: [{ type: "heading", status: "added", after: "## Diff heading" }], source: [] };
    await screen.findByText("Cache it.");
    const scrolled: string[] = [];
    const spy = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(function (this: HTMLElement) {
      scrolled.push(this.id);
    });
    try {
      fireEvent.click(screen.getByRole("button", { name: /Spec writer/ }));
      await screen.findByRole("region", { name: "Changes" });
      fireEvent.click(screen.getByRole("button", { name: "Back to the document" }));
      await screen.findByText("Cache it.");
      // happy-dom has no layout: every heading sits at the top, so the place is the last one.
      expect(scrolled).toEqual(["plan"]);
    } finally {
      spy.mockRestore();
    }
  });

  it("the review marks are looked for again once the diff closes", async () => {
    const { client } = setup({ review: true, target: { path: DOC, timeline: true } });
    client.reviews[DOC] = {
      path: DOC,
      task: null,
      approvals: [],
      comments: [{ id: "c1", author: "agent", kind: "comment", anchor: { quote: "Slow calls.", heading: "context", occurrence: 0 }, text: "Why slow?", state: "open", replies: [], at: "2026-10-28T10:00:00.000Z" }],
    };
    act(() => client.emitReviewChanged(DOC));
    await screen.findByText("Why slow?");
    await waitFor(() => expect(marksFound.boxes.at(-1)?.textContent).toContain("Slow calls."));
    fireEvent.click(screen.getByRole("button", { name: /Spec writer/ }));
    await screen.findByRole("region", { name: "Changes" });
    const seen = marksFound.boxes.length;
    fireEvent.click(screen.getByRole("button", { name: "Back to the document" }));
    await waitFor(() => expect(marksFound.boxes.length).toBeGreaterThan(seen));
    expect(marksFound.boxes.at(-1)?.textContent).toContain("Slow calls.");
  });

  it("another document drops the diff", async () => {
    const { client, props, view } = setup({ target: { path: DOC, timeline: true } });
    client.docTexts["docs/other.md"] = "Other text.\n";
    fireEvent.click(await screen.findByRole("button", { name: /Spec writer/ }));
    await screen.findByRole("region", { name: "Changes" });
    const { i18n, rerender } = await view;
    rerender(
      <I18nextProvider i18n={i18n}>
        <DocumentReader {...props} target={{ path: "docs/other.md" }} />
      </I18nextProvider>,
    );
    expect(await screen.findByText("Other text.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Changes" })).toBeNull();
  });
});
