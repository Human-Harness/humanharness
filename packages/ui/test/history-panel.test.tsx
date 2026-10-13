// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HistoryTaskView } from "../src/client";
import { HistoryPanel, entryLabel } from "../src/HistoryPanel";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const actions = { plan: { label: { es: "Planear la semana", en: "Plan the week" }, cost: "medium" as const } };
const date = "2026-10-13T10:00:00.000Z";
const groups: HistoryTaskView[] = [
  {
    taskId: "t2",
    actionId: "plan",
    start: "s1",
    end: "e2",
    date,
    noteTitle: "The week",
    changes: [
      { path: "old.md", kind: "deleted" },
      { path: "plan.md", kind: "modified" },
    ],
    entries: [
      { sha: "e2", message: "Note: The week", date },
      { sha: "m2", message: "Turn: plan it", date },
      { sha: "b2", message: "Before message", date },
    ],
  },
  { taskId: "t1", actionId: null, start: "s0", end: "e1", date, changes: [{ path: "q.md", kind: "added" }], entries: [{ sha: "e1", message: "Went back to before the task", date }] },
  { taskId: null, actionId: null, start: null, end: "s0", date, changes: [], entries: [{ sha: "s0", message: "Start", date }] },
];

async function open(opts: { disabled?: boolean; language?: "en" | "es" } = {}) {
  const client = new FakeClient();
  client.historyGroups = groups;
  const onRestored = vi.fn();
  const onClose = vi.fn();
  const lang = opts.language ?? "en";
  await renderIn(lang, <HistoryPanel client={client} actions={actions} lang={lang} disabled={opts.disabled} onClose={onClose} onRestored={onRestored} />);
  return { client, onRestored, onClose };
}

describe("HistoryPanel", () => {
  it("shows one row per task with its action, note, date and files changed; the newest starts open", async () => {
    await open();
    const newest = await screen.findByRole("button", { name: /Plan the week.*The week.*2 files changed/ });
    expect(newest.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /A question.*1 file changed/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: /Earlier.*0 files changed/ }).getAttribute("aria-expanded")).toBe("false");
    const files = screen.getByRole("list", { name: "Changed files" });
    expect(within(files).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Deletedold.md", "Changedplan.md"]);
    expect(screen.getByText("Note saved: The week")).toBeTruthy();
    expect(screen.getByText("The AI finished")).toBeTruthy();
    expect(screen.getByText("Before your message")).toBeTruthy();
  });

  it("opens a row on click and shows its entries in plain language", async () => {
    await open();
    fireEvent.click(await screen.findByRole("button", { name: /A question/ }));
    expect(screen.getByText("You went back to before this task")).toBeTruthy();
  });

  it("goes back to before a task after a confirmation", async () => {
    const { client, onRestored, onClose } = await open();
    fireEvent.click(await screen.findByRole("button", { name: "Go back to before this task" }));
    expect(screen.getByText("Go back to before this task? Everything it changed in your files will be undone.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Yes, go back" }));
    await waitFor(() => expect(client.restoredTasks).toEqual(["t2"]));
    expect(onRestored).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("goes back to one point", async () => {
    const { client } = await open();
    fireEvent.click((await screen.findAllByRole("button", { name: "Go back to this point" }))[1]);
    fireEvent.click(screen.getByRole("button", { name: "Yes, go back" }));
    await waitFor(() => expect(client.restored).toEqual(["m2"]));
  });

  it("disables both kinds of going back while a turn is live", async () => {
    await open({ disabled: true });
    expect(((await screen.findByRole("button", { name: "Go back to before this task" })) as HTMLButtonElement).disabled).toBe(true);
    for (const b of screen.getAllByRole("button", { name: "Go back to this point" })) expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers no 'before this task' for the Earlier group", async () => {
    await open();
    fireEvent.click(await screen.findByRole("button", { name: /Earlier/ }));
    expect(screen.getByText("Started")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Go back to before this task" })).toHaveLength(1);
  });

  it("speaks Spanish", async () => {
    await open({ language: "es" });
    expect(await screen.findByRole("button", { name: /Planear la semana.*2 archivos cambiados/ })).toBeTruthy();
    expect(screen.getByText("Resumen guardado: The week")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Volver a antes de esta tarea" })).toBeTruthy();
  });

  it("keeps an unknown subject as it is", () => {
    expect(entryLabel("Something else")).toBeNull();
    expect(entryLabel("Note: A title")).toEqual({ key: "history.entry.note", values: { title: "A title" } });
    expect(entryLabel("Stopped: hi")).toEqual({ key: "history.entry.stopped" });
  });
});
