// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentRead, ReviewView } from "../src/client";
import { DocumentReader, cutToBytes } from "../src/DocumentReader";
import { FakeClient, fakeBlob } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const ANALYSIS = [
  "---",
  "title: Search cache",
  "kind: analysis",
  "status: draft",
  "---",
  "> [!SUMMARY]",
  "> Cache for ten minutes.",
  "",
  "## Context",
  "",
  "Slow calls.",
  "",
  "### Numbers",
  "",
  "## Options",
  "",
  "See [the ADR](adr/007.md).",
].join("\n");
const kinds = { analysis: { when: "x", sections: ["Context", "Options", "Risks"], status: ["proposed", "accepted"] } };

function setup(over: Partial<Parameters<typeof DocumentReader>[0]> = {}, docs: Record<string, string> = { "docs/cache.md": ANALYSIS }) {
  const client = new FakeClient();
  Object.assign(client.docTexts, docs);
  const props = {
    client,
    target: { path: "docs/cache.md", agent: "Claude" },
    kinds,
    prefs: {},
    onPrefs: vi.fn(),
    full: false,
    onFull: vi.fn(),
    onClose: vi.fn(),
    onOpen: vi.fn(),
    ...over,
  };
  return { client, props, view: renderIn("en", <DocumentReader {...props} />) };
}

describe("DocumentReader (§5.2)", () => {
  it("shows the path as breadcrumbs, the title, the chips, when it changed, the reading time and the agent", async () => {
    setup();
    expect(await screen.findByRole("heading", { level: 1, name: "Search cache" })).toBeTruthy();
    const crumbs = screen.getByRole("navigation", { name: "Path" });
    expect([...crumbs.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["docs", "cache.md"]);
    expect(screen.getByText("analysis")).toBeTruthy();
    expect(screen.getByText("draft")).toBeTruthy();
    expect(screen.getByText("Not one of: proposed, accepted")).toBeTruthy();
    expect(screen.getByText("1 min read")).toBeTruthy();
    expect(screen.getByText("Written by Claude")).toBeTruthy();
    expect(screen.getByText(/^Changed /)).toBeTruthy();
  });

  it("the contents list ## and ###, jump on click, and hold the template note", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    setup();
    const toc = await screen.findByRole("navigation", { name: "Contents" });
    const links = [...toc.querySelectorAll("a")];
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Context", "#context"],
      ["Numbers", "#numbers"],
      ["Options", "#options"],
    ]);
    fireEvent.click(links[2]);
    expect(scroll).toHaveBeenCalled();
    expect(toc.querySelector(".hh-reader-template")?.textContent).toBe("Template analysis: missing section Risks.");
  });

  it("an unknown kind is a grey chip; no kinds declared means no check at all (D0)", async () => {
    setup({ kinds: { adr: { when: "x", sections: ["Status"] } } });
    expect(await screen.findByText("unknown kind")).toBeTruthy();
    cleanup();
    setup({ kinds: undefined });
    await screen.findByRole("heading", { level: 1, name: "Search cache" });
    expect(screen.queryByText("unknown kind")).toBeNull();
    expect(document.querySelector(".hh-reader-template")).toBeNull();
    expect(screen.queryByText(/Not one of/)).toBeNull();
  });

  it("broken front-matter: no chip, and the block never shows as text (§6)", async () => {
    setup({}, { "docs/cache.md": "---\nkind: analysis\nnot yaml here\n---\n# Plain" });
    expect(await screen.findByRole("heading", { name: "Plain" })).toBeTruthy();
    expect(screen.queryByText("analysis")).toBeNull();
    expect(document.body.textContent).not.toContain("not yaml here");
  });

  it("Source shows the raw text, read-only", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Source" }));
    const src = document.querySelector("pre.hh-reader-source");
    expect(src?.textContent).toBe(ANALYSIS);
  });

  it("full screen and close", async () => {
    const { props } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Full screen" }));
    expect(props.onFull).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(props.onClose).toHaveBeenCalled();
    cleanup();
    const again = setup({ full: true });
    fireEvent.click(await screen.findByRole("button", { name: "Show chat" }));
    expect(again.props.onFull).toHaveBeenCalledWith(false);
  });

  it("reading preferences: serif and large, always both fields", async () => {
    const { props } = setup({ prefs: { size: "large" } });
    fireEvent.click(await screen.findByRole("button", { name: "Aa reading preferences" }));
    fireEvent.click(screen.getByRole("button", { name: "Serif" }));
    expect(props.onPrefs).toHaveBeenCalledWith({ font: "serif", size: "large" });
    expect(document.querySelector(".hh-reader-doc.hh-reader-large")).not.toBeNull();
  });

  it("a .md link opens the linked document, resolved from this one", async () => {
    const { props } = setup();
    fireEvent.click(await screen.findByRole("link", { name: "the ADR" }));
    expect(props.onOpen).toHaveBeenCalledWith("docs/adr/007.md", undefined);
  });

  it("moved or deleted, outside the folder (§6)", async () => {
    setup({ target: { path: "docs/gone.md" } });
    expect(await screen.findByText("This document was moved or deleted.")).toBeTruthy();
    cleanup();
    setup({ target: { path: "../secret.md" } });
    expect(await screen.findByText("This file is outside your folder.")).toBeTruthy();
  });

  it("over 1 MB: the first 200 KB, then the notice", async () => {
    const big = `# Big\n\n${"word ".repeat(300_000)}`;
    setup({ target: { path: "big.md" } }, { "big.md": big });
    expect(await screen.findByText("Showing the first 200 KB of 1.4 MB. Open Source to see all of it.")).toBeTruthy();
  });

  it("live reload: draws the new text and keeps the place at the nearest heading", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = function (this: Element) {
      scroll(this.id);
    };
    const { client } = setup();
    await screen.findByRole("heading", { name: "Options" });
    scroll.mockClear();
    await act(async () => client.changeDocument("docs/cache.md", `${ANALYSIS}\n\n## Risks\n\nNew.`));
    expect(await screen.findByRole("heading", { name: "Risks" })).toBeTruthy();
    await waitFor(() => expect(scroll).toHaveBeenCalledWith("options"));
    expect(document.querySelector(".hh-reader-template")).toBeNull();
  });

  it("live reload of a deleted file says so", async () => {
    const { client } = setup();
    await screen.findByRole("heading", { level: 1, name: "Search cache" });
    await act(async () => client.changeDocument("docs/cache.md", null));
    expect(await screen.findByText("This document was moved or deleted.")).toBeTruthy();
  });
});

describe("DocumentReader: untrusted targets and big documents", () => {
  it("a path that is not a plain relative string is refused without asking main", async () => {
    const { client } = setup({ target: { path: 42 as unknown as string } });
    const read = vi.spyOn(client, "readDocument");
    expect(await screen.findByText("This file is outside your folder.")).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
    expect(screen.getByRole("navigation", { name: "Path" }).querySelectorAll("li").length).toBe(0);
  });

  it("the reading time counts the whole document, not only the part drawn", async () => {
    const big = `# Big\n\n${"word ".repeat(300_000)}`;
    setup({ target: { path: "big.md" } }, { "big.md": big });
    expect(await screen.findByText(`${Math.ceil(300_001 / 230)} min read`)).toBeTruthy();
  });

  it("Escape closes the preferences first, then the reader", async () => {
    const { props } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Aa reading preferences" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Serif" }), { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Serif" })).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("button", { name: "Source" }), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
  });

  it("applies a changed preference at once, even before the parent passes it back", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Aa reading preferences" }));
    fireEvent.click(screen.getByRole("button", { name: "Large" }));
    expect(document.querySelector(".hh-reader-doc.hh-reader-large")).not.toBeNull();
  });
});

describe("DocumentReader: anchors, reloads, watches and focus", () => {
  const OTHER = "# Other\n\n## Intro\n\nText.\n\n## Deep\n\nMore.";
  const scrolled = () => {
    const ids: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      ids.push(this.id);
    };
    return ids;
  };
  async function swap(s: ReturnType<typeof setup>, target: Parameters<typeof DocumentReader>[0]["target"]) {
    const { rerender, i18n } = await s.view;
    rerender(
      <I18nextProvider i18n={i18n}>
        <DocumentReader {...s.props} target={target} />
      </I18nextProvider>,
    );
  }

  it("opening another document at an anchor goes there once it is drawn", async () => {
    const ids = scrolled();
    const s = setup({}, { "docs/cache.md": ANALYSIS, "docs/other.md": OTHER });
    await screen.findByRole("heading", { name: "Options" });
    await act(async () => swap(s, { path: "docs/other.md", anchor: "deep", nonce: 2 }));
    expect(await screen.findByRole("heading", { name: "Deep" })).toBeTruthy();
    await waitFor(() => expect(ids).toContain("deep"));
  });

  it("a new anchor in the same document moves there, and the same anchor opened again moves there again", async () => {
    const ids = scrolled();
    const s = setup();
    await screen.findByRole("heading", { name: "Options" });
    await act(async () => swap(s, { path: "docs/cache.md", anchor: "options", nonce: 2 }));
    expect(ids).toEqual(["options"]);
    await act(async () => swap(s, { path: "docs/cache.md", anchor: "options", nonce: 3 }));
    expect(ids).toEqual(["options", "options"]);
  });

  it("only the latest read draws: an older answer arriving late is dropped", async () => {
    const s = setup();
    await screen.findByRole("heading", { name: "Options" });
    const answers: ((d: DocumentRead) => void)[] = [];
    vi.spyOn(s.client, "readDocument").mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    await act(async () => s.client.changeDocument("docs/cache.md", ANALYSIS));
    await act(async () => s.client.changeDocument("docs/cache.md", ANALYSIS));
    const read = (text: string): DocumentRead => ({ ok: true, text, mtime: s.client.documentMtime, size: text.length });
    await act(async () => answers[1](read("# Newest")));
    await act(async () => answers[0](read("# Stale")));
    expect(screen.getByRole("heading", { name: "Newest" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Stale" })).toBeNull();
  });

  it("stops watching on unmount and when the path changes", async () => {
    const client = new FakeClient();
    const offs: ReturnType<typeof vi.fn>[] = [];
    const watch = client.watchDocument.bind(client);
    vi.spyOn(client, "watchDocument").mockImplementation((file, listener) => {
      const off = vi.fn(watch(file, listener));
      offs.push(off);
      return off;
    });
    Object.assign(client.docTexts, { "docs/cache.md": ANALYSIS, "docs/other.md": OTHER });
    const s = setup({ client });
    await screen.findByRole("heading", { name: "Options" });
    await act(async () => swap(s, { path: "docs/other.md" }));
    expect(offs[0]).toHaveBeenCalledTimes(1);
    expect(offs[1]).not.toHaveBeenCalled();
    cleanup();
    expect(offs[1]).toHaveBeenCalledTimes(1);
  });

  it("finds heading ids only inside the reader", async () => {
    const outside = document.createElement("h2");
    outside.id = "options";
    document.body.prepend(outside);
    const hit: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      hit.push(this);
    };
    setup();
    const toc = await screen.findByRole("navigation", { name: "Contents" });
    fireEvent.click(within(toc).getByText("Options"));
    expect(hit).toHaveLength(1);
    expect(hit[0]).not.toBe(outside);
    expect(hit[0].closest("aside")).not.toBeNull();
    outside.remove();
  });

  it("the Aa button is named with Aa, controls its menu, and Escape gives focus back to it", async () => {
    setup();
    const aa = await screen.findByRole("button", { name: "Aa reading preferences" });
    fireEvent.click(aa);
    const menu = screen.getByRole("group", { name: "Reading preferences" });
    expect(aa.getAttribute("aria-controls")).toBe(menu.id);
    fireEvent.keyDown(within(menu).getByRole("button", { name: "Serif" }), { key: "Escape" });
    expect(document.activeElement).toBe(aa);
  });

  it("takes focus on open (the title), so Escape closes it at once", async () => {
    const { props } = setup();
    const title = await screen.findByRole("heading", { level: 1, name: "Search cache" });
    await waitFor(() => expect(document.activeElement).toBe(title));
    fireEvent.keyDown(title, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
  });
});

describe("cutToBytes", () => {
  it("cuts by UTF-8 bytes, never inside a character", () => {
    expect(cutToBytes("abc", 10)).toBe("abc");
    expect(cutToBytes("aéb", 2)).toBe("a");
    expect(cutToBytes("aéb", 3)).toBe("aé");
    expect(cutToBytes("😀😀", 5)).toBe("😀");
    const shown = cutToBytes("é".repeat(300_000), 200 * 1024);
    expect(new TextEncoder().encode(shown).length).toBeLessThanOrEqual(200 * 1024);
    expect(shown.length).toBe(100 * 1024);
  });
});

describe("review in the reader (review spec §6.1, D0)", () => {
  it("without `review` there is no column and no review call (D0)", async () => {
    const { client } = setup();
    await screen.findByRole("heading", { level: 1, name: "Search cache" });
    expect(screen.queryByRole("region", { name: "Comments" })).toBeNull();
    expect(client.reviewCalls).toEqual([]);
  });

  it("with `review` it shows the record's cards and draws again on a change", async () => {
    const { client } = setup({ review: true });
    await screen.findByRole("button", { name: "Approve" });
    client.reviews["docs/cache.md"] = {
      path: "docs/cache.md",
      task: null,
      approvals: [],
      comments: [{ id: "c1", author: "agent", kind: "question", anchor: { quote: "Slow calls.", heading: "context", occurrence: 0 }, text: "How slow?", options: [{ label: "A", text: "Slow calls." }, { label: "B", text: "Very slow calls." }], state: "open", replies: [], at: "2026-10-28T10:00:00.000Z" }],
    };
    act(() => client.emitReviewChanged("docs/cache.md"));
    expect(await screen.findByText("How slow?")).toBeTruthy();
  });

  it("an answer swaps the passage: the reader reads the document again", async () => {
    const { client } = setup({ review: true });
    client.reviews["docs/cache.md"] = {
      path: "docs/cache.md",
      task: null,
      approvals: [],
      comments: [{ id: "c1", author: "agent", kind: "question", anchor: { quote: "Slow calls.", heading: "context", occurrence: 0 }, text: "How slow?", options: [{ label: "A", text: "Slow calls." }, { label: "B", text: "Very slow calls." }], state: "open", replies: [], at: "2026-10-28T10:00:00.000Z" }],
    };
    act(() => client.emitReviewChanged("docs/cache.md"));
    fireEvent.click(await screen.findByRole("radio", { name: "B" }));
    const doc = document.querySelector(".hh-review-text")!;
    await waitFor(() => expect(doc.textContent).toContain("Very slow calls."));
    expect(client.reviewCalls.some((c) => c.op === "answer")).toBe(true);
  });

  it("the review-only layout class is on the reader only with `review` (D0)", async () => {
    setup();
    const plain = await screen.findByRole("complementary", { name: "Document" });
    expect(plain.className).not.toContain("hh-reader-reviewing");
    cleanup();
    setup({ review: true });
    expect((await screen.findByRole("complementary", { name: "Document" })).className).toContain("hh-reader-reviewing");
  });

  it("a review view still pending when another document opens is never drawn over it", async () => {
    const OTHER_DOC = "## Other\n\nSlow calls.\n";
    const s = setup({ review: true }, { "docs/cache.md": ANALYSIS, "docs/other.md": OTHER_DOC });
    await screen.findByRole("button", { name: "Approve" });
    const pending: ((v: ReviewView) => void)[] = [];
    const view = s.client.documents.view;
    // A's view hangs until the end; B's answers at once.
    s.client.documents.view = (p) => (p === "docs/cache.md" ? new Promise<ReviewView>((resolve) => pending.push(resolve)) : view(p));
    act(() => s.client.emitReviewChanged("docs/cache.md"));
    const { rerender, i18n } = await s.view;
    rerender(
      <I18nextProvider i18n={i18n}>
        <DocumentReader {...s.props} target={{ path: "docs/other.md" }} />
      </I18nextProvider>,
    );
    await screen.findByRole("heading", { name: "Other" });
    const summary = { status: "draft", open: 1, blocking: 0, unsent: 0, approvedAt: null } as never;
    const forA: ReviewView = {
      ok: true,
      blob: "a",
      summary,
      review: { path: "docs/cache.md", task: null, approvals: [], comments: [{ id: "c1", author: "agent", kind: "comment", anchor: { quote: "Slow calls.", heading: "context", occurrence: 0 }, text: "From A", state: "open", replies: [], at: "2026-10-28T10:00:00.000Z" }] },
    };
    expect(pending).toHaveLength(1);
    await act(async () => {
      for (const done of pending) done(forA);
    });
    expect(screen.queryByText("From A")).toBeNull();
  });

  it("no column until the first comment: a draft made on a selection brings it (§6.1)", async () => {
    setup({ review: true });
    await screen.findByRole("button", { name: "Approve" });
    expect(screen.queryByRole("region", { name: "Comments" })).toBeNull();
    const para = screen.getByText("Slow calls.");
    const range = document.createRange();
    range.selectNodeContents(para);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    fireEvent.mouseUp(para);
    fireEvent.click(await screen.findByRole("button", { name: "Comment" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Your comment" }), { target: { value: "How slow?" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    const column = await screen.findByRole("region", { name: "Comments" });
    expect(within(column).getByText("How slow?")).toBeTruthy();
  });

  it("a record that can't be read shows a note and no column", async () => {
    const { client } = setup({ review: true });
    client.documents.view = async () => ({ ok: false, reason: "broken" });
    act(() => client.emitReviewChanged("docs/cache.md"));
    expect((await screen.findByRole("alert")).textContent).toBe("The review of this document can't be read. Fix or delete .harness/reviews/docs/cache.md.json.");
    expect(screen.queryByRole("region", { name: "Comments" })).toBeNull();
  });
});

describe("commenting on a selection, the footer bar (review spec §5.2–§5.4)", () => {
  const select = (node: Node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  };

  it("a selection in the text shows 'Comment'; saving makes a draft with the heading above it", async () => {
    const { client } = setup({ review: true });
    await screen.findByRole("button", { name: "Approve" });
    const para = screen.getByText("Slow calls.");
    select(para);
    fireEvent.mouseUp(para);
    fireEvent.click(await screen.findByRole("button", { name: "Comment" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Your comment" }), { target: { value: "How slow?" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(client.reviewCalls.find((c) => c.op === "comment")?.args).toEqual(["docs/cache.md", { selected: "Slow calls.", heading: "context", text: "How slow?" }]));
    expect(await screen.findByText("How slow?")).toBeTruthy();
  });

  it("a selection that runs past the end of the text (a triple click on the last paragraph) keeps the part inside it", async () => {
    const { client } = setup({ review: true });
    await screen.findByRole("button", { name: "Approve" });
    const para = screen.getByText("Slow calls.");
    const box = para.closest(".hh-review-text")!;
    const range = document.createRange();
    range.setStart(para.firstChild!, 0);
    range.setEndAfter(box);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    fireEvent.mouseUp(para);
    fireEvent.click(await screen.findByRole("button", { name: "Comment" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Your comment" }), { target: { value: "How slow?" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(client.reviewCalls.find((c) => c.op === "comment")).toBeTruthy());
    const inside = document.createRange();
    inside.setStart(para.firstChild!, 0);
    inside.setEndAfter(box.lastChild!);
    expect(client.reviewCalls.find((c) => c.op === "comment")?.args[1]).toMatchObject({ selected: inside.toString(), heading: "context" });
  });

  it("a selection the document doesn't hold says so; Escape closes the pick before the reader", async () => {
    const { client, props } = setup({ review: true });
    await screen.findByRole("button", { name: "Approve" });
    client.documents.comment = async () => ({ ok: false, reason: "not-found" });
    const para = screen.getByText("Slow calls.");
    select(para);
    fireEvent.mouseUp(para);
    fireEvent.click(await screen.findByRole("button", { name: "Comment" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Your comment" }), { target: { value: "?" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That text could not be found in the document. Select plain text, not a diagram.");
    select(para);
    fireEvent.mouseUp(para);
    const comment = await screen.findByRole("button", { name: "Comment" });
    fireEvent.keyDown(comment, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Comment" })).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("without `review` a selection offers nothing and there is no footer bar (D0)", async () => {
    setup();
    await screen.findByRole("heading", { level: 1, name: "Search cache" });
    const para = screen.getByText("Slow calls.");
    select(para);
    fireEvent.mouseUp(para);
    expect(screen.queryByRole("button", { name: "Comment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("'Approve' passes the blob of the version shown", async () => {
    const { client } = setup({ review: true });
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(client.reviewCalls.find((c) => c.op === "approve")?.args).toEqual(["docs/cache.md", fakeBlob(ANALYSIS), {}]));
  });

  it("an edit on disk turns 'Approved' into stale, and approve then sends the new version's blob", async () => {
    const { client } = setup({ review: true });
    client.reviews["docs/cache.md"] = { path: "docs/cache.md", task: null, comments: [], approvals: [{ blob: fakeBlob(ANALYSIS), at: "2026-10-28T10:00:00.000Z" }] };
    client.currentBlobs["docs/cache.md"] = fakeBlob(ANALYSIS);
    act(() => client.emitReviewChanged("docs/cache.md"));
    expect(await screen.findByText(/^Approved · /)).toBeTruthy();
    const edited = ANALYSIS.replace("Slow calls.", "Fast calls.");
    client.currentBlobs["docs/cache.md"] = fakeBlob(edited);
    // Only the file watch fires: no review change is emitted.
    await act(async () => client.changeDocument("docs/cache.md", edited));
    expect(await screen.findByText("Changed since approval")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(client.reviewCalls.find((c) => c.op === "approve")?.args).toEqual(["docs/cache.md", fakeBlob(edited), {}]));
  });

  it("after Cancel the focus goes back to the text", async () => {
    setup({ review: true });
    await screen.findByRole("button", { name: "Approve" });
    const para = screen.getByText("Slow calls.");
    select(para);
    fireEvent.mouseUp(para);
    fireEvent.click(await screen.findByRole("button", { name: "Comment" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement?.className).toContain("hh-reader-scroll");
  });

  it("an approved version that can't be read says so, not 'too large'", async () => {
    const { client } = setup({ review: true });
    await screen.findByRole("button", { name: "Approve" });
    client.reviews["docs/cache.md"] = { path: "docs/cache.md", task: null, comments: [], approvals: [{ blob: "0".repeat(40), at: "2026-10-28T10:00:00.000Z" }] };
    client.currentBlobs["docs/cache.md"] = "1".repeat(40);
    act(() => client.emitReviewChanged("docs/cache.md"));
    fireEvent.click(await screen.findByRole("button", { name: "See what changed" }));
    const diff = await screen.findByRole("region", { name: "Changes since the approval" });
    expect(diff.textContent).toBe("The approved version can't be read any more, so there is nothing to compare.");
  });

  it("'See what changed' shows what changed since the approval, with the timeline's diff", async () => {
    const { client } = setup({ review: true });
    await screen.findByRole("button", { name: "Approve" });
    client.reviews["docs/cache.md"] = { path: "docs/cache.md", task: null, comments: [], approvals: [{ blob: "0".repeat(40), at: "2026-10-28T10:00:00.000Z" }] };
    client.currentBlobs["docs/cache.md"] = "1".repeat(40);
    const approved = "c".repeat(40);
    client.timelines["docs/cache.md"] = [
      { kind: "approval", author: { kind: "person", label: "You" }, label: "v1 approved", at: "2026-10-28T10:00:00.000Z", from: "d".repeat(40), to: approved, version: 1, lastApproved: true, commits: [{ id: approved, subject: "Approved: docs/cache.md", at: "2026-10-28T10:00:00.000Z" }] },
    ];
    client.diffs[`docs/cache.md|${approved}|current`] = {
      ok: true,
      kind: "markdown",
      same: false,
      truncated: false,
      blocks: [{ type: "paragraph", status: "changed", before: "Slow calls.", after: "Fast calls.", parts: [{ kind: "del", text: "Slow" }, { kind: "ins", text: "Fast" }, { kind: "same", text: " calls." }] }],
      source: [],
    };
    act(() => client.emitReviewChanged("docs/cache.md"));
    fireEvent.click(await screen.findByRole("button", { name: "See what changed" }));
    const diff = await screen.findByRole("region", { name: "Changes since the approval" });
    await waitFor(() => expect(diff.querySelector("ins")?.textContent).toBe("Fast"));
    expect(diff.querySelector("del")?.textContent).toBe("Slow");
    fireEvent.click(screen.getByRole("button", { name: "Hide changes" }));
    expect(screen.queryByRole("region", { name: "Changes since the approval" })).toBeNull();
  });

  it("'See what changed' starts from the approval the record holds last, not the newest on the timeline", async () => {
    const { client } = setup({ review: true });
    await screen.findByRole("button", { name: "Approve" });
    client.reviews["docs/cache.md"] = { path: "docs/cache.md", task: null, comments: [], approvals: [{ blob: "0".repeat(40), at: "2026-10-28T10:00:00.000Z" }] };
    client.currentBlobs["docs/cache.md"] = "1".repeat(40);
    const v1 = "c".repeat(40);
    const v2 = "e".repeat(40);
    const you = { kind: "person" as const, label: "You" };
    client.timelines["docs/cache.md"] = [
      { kind: "goBack", author: you, label: "Went back to v1", at: "2026-10-28T10:20:00.000Z", from: v2, to: "f".repeat(40), back: { version: 1 }, commits: [{ id: "f".repeat(40), subject: "Went back to an earlier point", at: "2026-10-28T10:20:00.000Z" }] },
      { kind: "approval", author: you, label: "v2 approved", at: "2026-10-28T10:10:00.000Z", from: v1, to: v2, version: 2, commits: [{ id: v2, subject: "Approved: docs/cache.md", at: "2026-10-28T10:10:00.000Z" }] },
      { kind: "approval", author: you, label: "v1 approved", at: "2026-10-28T10:00:00.000Z", from: "d".repeat(40), to: v1, version: 1, lastApproved: true, commits: [{ id: v1, subject: "Approved: docs/cache.md", at: "2026-10-28T10:00:00.000Z" }] },
    ];
    const view = (after: string) => ({ ok: true as const, kind: "markdown" as const, same: false, truncated: false, blocks: [{ type: "paragraph" as const, status: "added" as const, after }], source: [] });
    client.diffs[`docs/cache.md|${v1}|current`] = view("Since v1.");
    client.diffs[`docs/cache.md|${v2}|current`] = view("Since v2.");
    act(() => client.emitReviewChanged("docs/cache.md"));
    fireEvent.click(await screen.findByRole("button", { name: "See what changed" }));
    const diff = await screen.findByRole("region", { name: "Changes since the approval" });
    await within(diff).findByText("Since v1.");
    expect(within(diff).queryByText("Since v2.")).toBeNull();
  });

  it("'See what changed' asks again when the document changes while it shows", async () => {
    const { client } = setup({ review: true });
    await screen.findByRole("button", { name: "Approve" });
    client.reviews["docs/cache.md"] = { path: "docs/cache.md", task: null, comments: [], approvals: [{ blob: "0".repeat(40), at: "2026-10-28T10:00:00.000Z" }] };
    client.currentBlobs["docs/cache.md"] = "1".repeat(40);
    const approved = "c".repeat(40);
    client.timelines["docs/cache.md"] = [
      { kind: "approval", author: { kind: "person", label: "You" }, label: "v1 approved", at: "2026-10-28T10:00:00.000Z", from: "d".repeat(40), to: approved, version: 1, lastApproved: true, commits: [{ id: approved, subject: "Approved: docs/cache.md", at: "2026-10-28T10:00:00.000Z" }] },
    ];
    const key = `docs/cache.md|${approved}|current`;
    const said = (after: string) => ({
      ok: true as const,
      kind: "markdown" as const,
      same: false,
      truncated: false,
      blocks: [{ type: "paragraph" as const, status: "added" as const, after }],
      source: [],
    });
    client.diffs[key] = said("First edit.");
    act(() => client.emitReviewChanged("docs/cache.md"));
    fireEvent.click(await screen.findByRole("button", { name: "See what changed" }));
    const diff = await screen.findByRole("region", { name: "Changes since the approval" });
    await within(diff).findByText("First edit.");
    client.diffs[key] = said("Second edit.");
    await act(async () => client.changeDocument("docs/cache.md", `${ANALYSIS}\n\nSecond edit.`));
    await within(screen.getByRole("region", { name: "Changes since the approval" })).findByText("Second edit.");
  });
});
