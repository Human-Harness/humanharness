// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteView } from "../src/client";
import { NotesPage } from "../src/NotesPage";
import { renderIn } from "./render";

afterEach(cleanup);

const notes: NoteView[] = [
  { slug: "turn", title: "A turn", action: "turn", date: "2026-10-12T11:20:00.000Z", summary: ["Five pieces", "Events come back"], decisions: [], path: ".harness/notes/turn.md" },
  { slug: "q-chats", title: "Where chats live", date: "2026-10-11T10:00:00.000Z", summary: ["In .harness/chats"], decisions: [], path: ".harness/notes/q-chats.md" },
];

/** The page with its open note held as ChatView holds it. */
function Host(props: { first?: string; notes?: NoteView[]; onResume?: (n: NoteView) => void; onOpenFile?: (p: string) => Promise<boolean>; onBack?: () => void }) {
  const [open, setOpen] = useState(props.first);
  return (
    <NotesPage
      notes={props.notes ?? notes}
      {...(open ? { open } : {})}
      disabled={false}
      onPick={setOpen}
      onResume={props.onResume ?? (() => {})}
      onOpenFile={props.onOpenFile ?? (async () => true)}
      onBack={props.onBack ?? (() => {})}
    />
  );
}

describe("NotesPage", () => {
  it("lists the notes under Files with their dates and key points, and says how the notes help", async () => {
    await renderIn("en", <Host />, { theme: true });
    const page = screen.getByRole("region", { name: "Files" });
    const list = within(page).getByRole("region", { name: "Notes" });
    expect(within(list).getByText("2 topics summarized")).toBeTruthy();
    expect(within(list).getByRole("button", { name: /A turn/ }).textContent).toMatch(/2 key points/);
    expect(within(list).getByRole("button", { name: /Where chats live/ }).textContent).toMatch(/1 key point/);
    expect(within(page).getByText("The next question starts from your summaries instead of re-reading the code.")).toBeTruthy();
    expect(page.textContent).not.toMatch(/token/i);
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Files"));
  });

  it("opens a note's detail in the same column, resumes it, opens its file, and Escape goes back to its row", async () => {
    const onResume = vi.fn();
    const onOpenFile = vi.fn(async () => false);
    await renderIn("en", <Host onResume={onResume} onOpenFile={onOpenFile} />, { theme: true });
    fireEvent.click(screen.getByRole("button", { name: /A turn/ }));
    const page = screen.getByRole("region", { name: "A turn" });
    await waitFor(() => expect(document.activeElement?.textContent).toBe("A turn"));
    expect(within(page).getByText("Five pieces")).toBeTruthy();
    expect(within(page).getByText(".harness/notes/turn.md")).toBeTruthy();
    fireEvent.click(within(page).getByRole("button", { name: "Pick this topic up again" }));
    expect(onResume).toHaveBeenCalledWith(notes[0]);
    fireEvent.click(within(page).getByRole("button", { name: "Open the file" }));
    expect(onOpenFile).toHaveBeenCalledWith(".harness/notes/turn.md");
    expect((await within(page).findByRole("alert")).textContent).toBe("I couldn't open that file.");
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(screen.getByRole("region", { name: "Files" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /A turn/ }));
  });

  it("opens straight on the note asked for; from the list, Escape goes back to the task", async () => {
    const onBack = vi.fn();
    await renderIn("en", <Host first="q-chats" onBack={onBack} />, { theme: true });
    expect(screen.getByRole("region", { name: "Where chats live" })).toBeTruthy();
    expect(screen.getByText("In .harness/chats")).toBeTruthy();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    fireEvent.keyDown(screen.getByRole("heading", { name: "Files" }), { key: "Escape" });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("says so when there are no notes yet", async () => {
    await renderIn("en", <Host notes={[]} />, { theme: true });
    expect(screen.getByText("No summaries yet. Each topic you close leaves one here.")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
