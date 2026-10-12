// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
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
    await renderIn("es", <NotesPanel notes={notes} lang="es" disabled={false} onResume={onResume} onOpen={onOpen} onClose={() => {}} />);
    const panel = screen.getByRole("dialog", { name: "Lo que quedó claro" });
    expect(within(panel).getByText("Five pieces")).toBeTruthy();
    expect(within(panel).getByText(".harness/notes/turn.md")).toBeTruthy();
    expect(within(panel).getByText(/1 idea clave/)).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Retomar este tema" }));
    expect(onResume).toHaveBeenCalledWith(notes[0]);
    fireEvent.click(within(panel).getByRole("button", { name: "Abrir el archivo" }));
    expect(onOpen).toHaveBeenCalledWith(".harness/notes/turn.md");
    expect(within(panel).getByText("La próxima pregunta arranca desde tus resúmenes, sin volver a leer el código.")).toBeTruthy();
    expect(panel.textContent).not.toMatch(/token/i);
  });

  it("opens another note, says when a file can't be opened, and closes with Escape", async () => {
    const onClose = vi.fn();
    await renderIn("en", <NotesPanel notes={notes} expanded="q-chats" lang="en" disabled={false} onResume={() => {}} onOpen={async () => false} onClose={onClose} />);
    const panel = screen.getByRole("dialog", { name: "What's clear so far" });
    expect(within(panel).getByText("In .harness/chats")).toBeTruthy();
    expect(within(panel).queryByText("Five pieces")).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: /A turn/ }));
    expect(within(panel).getByText("Five pieces")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Open the file" }));
    expect((await within(panel).findByRole("alert")).textContent).toBe("I couldn't open that file.");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("says there are no notes yet, and can't resume while a turn runs", async () => {
    await renderIn("en", <NotesPanel notes={[]} lang="en" disabled onResume={() => {}} onOpen={async () => true} onClose={() => {}} />);
    expect(screen.getByText("No summaries yet. Each topic you close leaves one here.")).toBeTruthy();
    cleanup();
    await renderIn("en", <NotesPanel notes={notes} lang="en" disabled onResume={() => {}} onOpen={async () => true} onClose={() => {}} />);
    expect((screen.getByRole("button", { name: "Pick this topic up again" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
