// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";
import { ChatView } from "../../../ui/src/ChatView";
import type { ChatEntry } from "../../../ui/src/client";
import { HhTheme } from "../../../ui/src/guide";
import { createBlockRegistry } from "../../../ui/src/layout/registry";
import type { SearchIntent } from "../../../ui/src/search/intent";
import { documentsRegistry, withDocuments } from "../../../ui/test/documents-mod";
import { FakeClient } from "../../../ui/test/fake-client";
import { renderIn } from "../../../ui/test/render";

afterEach(cleanup);

const card = { path: "specs/a.md", title: "Filter", kind: "spec", change: "new" as const, words: 120 };
const answer: ChatEntry = { id: "a1", role: "assistant", text: "I wrote the spec.", blocks: [], activities: [], at: "2026-10-28T10:00:00.000Z", engine: "claude", documents: [card] };

async function chat(registry = documentsRegistry(), review = false) {
  const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
  client.chat = [answer];
  client.docTexts[card.path] = "## Scope\n";
  if (review) client.state.review = true;
  await renderIn("en", withDocuments(<ChatView client={client} state={client.state} components={{}} stateBlocks={[]} />, registry), { theme: true });
  await screen.findByText("I wrote the spec.");
  return client;
}
const reader = () => screen.queryByRole("complementary", { name: "Document" });
const openCard = async () => {
  fireEvent.click(await screen.findByRole("button", { name: /Filter/ }));
  return screen.findByRole("complementary", { name: "Document" });
};

describe("the documents mod's ui", () => {
  it("registers the file opener: a card opens its reader in the reader's slot", async () => {
    const registry = documentsRegistry();
    expect(registry.slot("opener").map((o) => o.mod)).toEqual(["documents"]);
    await chat(registry);
    await openCard();
    expect(registry.slot("openPanel").map((p) => p.mod)).toEqual(["documents"]);
    expect(document.querySelector(".hh-body.hh-with-reader")).not.toBeNull();
  });

  it("without it the chat opens nothing", async () => {
    const client = await chat(createBlockRegistry());
    const button = await screen.findByRole("button", { name: /Filter/ });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    act(() => client.openDocument(card.path));
    expect(reader()).toBeNull();
  });

  it("a historyOnly file opens its timeline's split view; closing it gives the composer the focus", async () => {
    const registry = documentsRegistry();
    await chat(registry);
    // Something that stays on screen holds the focus: the split view still gives it to the composer, as before.
    screen.getByRole("button", { name: /Filter/ }).focus();
    act(() => registry.slot("opener")[0].open({ path: "data.json", historyOnly: true }));
    const view = await screen.findByRole("region", { name: "File history" });
    expect(view.textContent).toContain("data.json");
    expect(reader()).toBeNull();
    fireEvent.click(within(view).getByRole("button", { name: "Close file history" }));
    expect(screen.queryByRole("region", { name: "File history" })).toBeNull();
    expect(document.querySelector(".hh-with-reader")).toBeNull();
    expect(document.activeElement).toBe(document.querySelector(".hh-composer textarea"));
  });

  it("another page takes a file's history away and leaves the focus where it is; the reader stays", async () => {
    const registry = documentsRegistry();
    const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
    client.chat = [answer];
    client.docTexts[card.path] = "## Scope\n";
    const searchRef: { current: ((i: SearchIntent) => boolean) | null } = { current: null };
    const view = (n?: number) =>
      withDocuments(
        <ChatView client={client} state={client.state} components={{}} stateBlocks={[]} searchRef={searchRef} taskPage={n ? { page: "notes", n } : null} />,
        registry,
      );
    const { i18n, rerender } = await renderIn("en", view(), { theme: true });
    const pick = (n: number) =>
      rerender(
        <I18nextProvider i18n={i18n}>
          <HhTheme>{view(n)}</HhTheme>
        </I18nextProvider>,
      );
    await openCard();
    pick(1);
    expect(reader()).not.toBeNull();

    fireEvent.click(within(reader()!).getByRole("button", { name: "Close" }));
    act(() => void searchRef.current!({ kind: "timeline", path: "data.json" } as SearchIntent));
    await screen.findByRole("region", { name: "File history" });
    const elsewhere = document.body.appendChild(document.createElement("button"));
    elsewhere.focus();
    pick(2);
    expect(screen.queryByRole("region", { name: "File history" })).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it("the reader's font is saved, and kept when it opens again", async () => {
    const client = await chat();
    let opened = await openCard();
    fireEvent.click(within(opened).getByRole("button", { name: /reading preferences/ }));
    fireEvent.click(within(opened).getByRole("button", { name: "Serif" }));
    expect(client.state.config.reader).toEqual({ font: "serif", size: "normal" });
    fireEvent.click(within(opened).getByRole("button", { name: "Close" }));
    expect(reader()).toBeNull();
    opened = await openCard();
    fireEvent.click(within(opened).getByRole("button", { name: /reading preferences/ }));
    expect(within(opened).getByRole("button", { name: "Serif" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("the reader's Focus asks the chat for quiet through the task view seam, and leaving it ends it", async () => {
    const registry = documentsRegistry();
    await chat(registry, true);
    const opened = await openCard();
    fireEvent.click(await within(opened).findByRole("button", { name: "Focus" }));
    expect(registry.slot("quiet").map((q) => q.mod)).toEqual(["documents"]);
    expect(document.querySelector(".hh-body.hh-focus")).not.toBeNull();
    fireEvent.click(within(opened).getByRole("button", { name: "Leave focus" }));
    expect(registry.slot("quiet")).toEqual([]);
    expect(document.querySelector(".hh-focus")).toBeNull();
  });

  it("the review and focus pieces are the mod's: the core's ui no longer exports them", async () => {
    const core = Object.keys(await import("../../../ui/src"));
    for (const name of ["ReviewBar", "NO_BAR_DRAFT", "ReviewColumn", "FocusMarkers", "ApprovedDiff", "findMarks", "drawMarks", "clearMarks"])
      expect(core).not.toContain(name);
  });
});
