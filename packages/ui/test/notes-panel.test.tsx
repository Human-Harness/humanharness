// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteView } from "../src/client";
import { NotesPanel } from "../src/NotesPanel";
import { renderIn } from "./render";

afterEach(cleanup);

const notes: NoteView[] = [
  { slug: "turn", title: "A turn", action: "turn", date: "2026-10-12T11:20:00.000Z", summary: ["Five pieces", "Events come back"], decisions: [], path: ".harness/notes/turn.md" },
  { slug: "q-chats", title: "Where chats live", date: "2026-10-11T10:00:00.000Z", summary: ["In .harness/chats"], decisions: [], path: ".harness/notes/q-chats.md" },
];

describe("NotesPanel", () => {
  it("opens the newest note with its points, path and actions; the others show how many points", async () => {
    const onResume = vi.fn();
    const onOpen = vi.fn(async () => true);
    await renderIn("en", <NotesPanel notes={notes} disabled={false} onResume={onResume} onOpen={onOpen} onClose={() => {}} />);
    const panel = screen.getByRole("dialog", { name: "What's clear so far" });
    expect(within(panel).getByText("Five pieces")).toBeTruthy();
    expect(within(panel).getByText(".harness/notes/turn.md")).toBeTruthy();
    expect(within(panel).getByText(/1 key point/)).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Pick this topic up again" }));
    expect(onResume).toHaveBeenCalledWith(notes[0]);
    fireEvent.click(within(panel).getByRole("button", { name: "Open the file" }));
    expect(onOpen).toHaveBeenCalledWith(".harness/notes/turn.md");
    expect(within(panel).getByText("The next question starts from your summaries instead of re-reading the code.")).toBeTruthy();
    expect(panel.textContent).not.toMatch(/token/i);
  });

  it("opens another note, says when a file can't be opened, and closes with Escape", async () => {
    const onClose = vi.fn();
    await renderIn("en", <NotesPanel notes={notes} expanded="q-chats" disabled={false} onResume={() => {}} onOpen={async () => false} onClose={onClose} />);
    const panel = screen.getByRole("dialog", { name: "What's clear so far" });
    expect(within(panel).getByText("In .harness/chats")).toBeTruthy();
    expect(within(panel).queryByText("Five pieces")).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: /A turn/ }));
    expect(within(panel).getByText("Five pieces")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Open the file" }));
    expect((await within(panel).findByRole("alert")).textContent).toBe("I couldn't open that file.");
    // Handled: a listener further out (focus mode's) leaves this Escape alone.
    expect(fireEvent.keyDown(document, { key: "Escape" })).toBe(false);
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the note's header button in place when it opens or closes, so focus stays on it", async () => {
    await renderIn("en", <NotesPanel notes={notes} disabled={false} onResume={() => {}} onOpen={async () => true} onClose={() => {}} />);
    const panel = screen.getByRole("dialog", { name: "What's clear so far" });
    const turn = within(panel).getByRole("button", { name: /A turn/ });
    const chats = within(panel).getByRole("button", { name: /Where chats live/ });
    expect(turn.getAttribute("aria-expanded")).toBe("true");
    expect(chats.getAttribute("aria-expanded")).toBe("false");
    chats.focus();
    fireEvent.click(chats);
    expect(chats.isConnected).toBe(true);
    expect(document.activeElement).toBe(chats);
    expect(chats.getAttribute("aria-expanded")).toBe("true");
    expect(turn.getAttribute("aria-expanded")).toBe("false");
    expect(within(panel).getByText("In .harness/chats")).toBeTruthy();
    expect(within(panel).queryByText("Five pieces")).toBeNull();
    fireEvent.click(chats);
    expect(chats.getAttribute("aria-expanded")).toBe("false");
    expect(within(panel).queryByText("In .harness/chats")).toBeNull();
  });

  it("follows the note asked for while it is open", async () => {
    const props = { notes, disabled: false, onResume: () => {}, onOpen: async () => true, onClose: () => {} };
    const { rerender, i18n } = await renderIn("en", <NotesPanel {...props} expanded="turn" />);
    expect(screen.getByText("Five pieces")).toBeTruthy();
    rerender(
      <I18nextProvider i18n={i18n}>
        <NotesPanel {...props} expanded="q-chats" />
      </I18nextProvider>,
    );
    expect(screen.getByText("In .harness/chats")).toBeTruthy();
    expect(screen.queryByText("Five pieces")).toBeNull();
  });

  it("gives focus back to what opened it when it closes", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    try {
      const onClose = vi.fn();
      await renderIn("en", <NotesPanel notes={notes} disabled={false} onResume={() => {}} onOpen={async () => true} onClose={onClose} />);
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onClose).toHaveBeenCalled();
      expect(document.activeElement).toBe(opener);
    } finally {
      opener.remove();
    }
  });

  it("says there are no notes yet, and can't resume while a turn runs", async () => {
    await renderIn("en", <NotesPanel notes={[]} disabled onResume={() => {}} onOpen={async () => true} onClose={() => {}} />);
    expect(screen.getByText("No summaries yet. Each topic you close leaves one here.")).toBeTruthy();
    cleanup();
    await renderIn("en", <NotesPanel notes={notes} disabled onResume={() => {}} onOpen={async () => true} onClose={() => {}} />);
    expect((screen.getByRole("button", { name: "Pick this topic up again" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the Notes drawer (UI refresh spec §5.7)", () => {
  it("titles itself What's clear so far, counts topics, and gives each note a card, its key points and two actions", async () => {
    await renderIn("en", <NotesPanel notes={notes} disabled={false} onResume={() => {}} onOpen={async () => true} onClose={() => {}} />);
    const panel = screen.getByRole("dialog", { name: "What's clear so far" });
    expect(panel.classList.contains("hh-drawer")).toBe(true);
    expect(within(panel).getByText("2 topics summarized")).toBeTruthy();
    expect(within(panel).getByText("2 key points").className).toContain("hh-tag-blue");
    expect(within(panel).getByText("1 key point").className).toContain("hh-tag-blue");
    expect(within(panel).getByText("2 key points").closest("li")?.classList.contains("hh-card")).toBe(true);
    // The line saying what notes are for comes first, where they are kept last.
    const why = within(panel).getByText("The next question starts from your summaries instead of re-reading the code.");
    const where = within(panel).getByText(/is summarized in \.harness\/notes\//);
    const cards = panel.querySelector(".hh-note-cards")!;
    expect(why.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(where.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Pick this topic up again" }).classList.contains("hh-pill")).toBe(true);
    expect(within(panel).getByRole("button", { name: "Open the file" }).classList.contains("hh-pill")).toBe(true);
  });

  it("says one topic in the singular", async () => {
    await renderIn("en", <NotesPanel notes={notes.slice(0, 1)} disabled={false} onResume={() => {}} onOpen={async () => true} onClose={() => {}} />);
    expect(screen.getByText("1 topic summarized")).toBeTruthy();
  });
});
