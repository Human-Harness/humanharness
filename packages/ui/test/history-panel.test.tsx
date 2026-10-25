// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionOption, HistoryTaskView } from "../src/client";
import { HistoryPanel, entryLabel } from "../src/HistoryPanel";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const actions = { plan: { label: { es: "Planear la semana", en: "Plan the week" }, cost: "medium" as const } };
const date = "2026-10-13T11:00:00.000Z";
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
  {
    taskId: "t1",
    actionId: null,
    start: "s0",
    end: "e1",
    date: "2026-10-13T10:00:00.000Z",
    changes: [{ path: "q.md", kind: "added" }],
    entries: [{ sha: "e1", message: "Turn: answer", date: "2026-10-13T10:00:00.000Z" }],
  },
  // Restores carry no task: they land in this group, even when they are the newest commit.
  {
    taskId: null,
    actionId: null,
    start: null,
    end: "r1",
    date: "2026-10-13T12:00:00.000Z",
    changes: [],
    entries: [
      { sha: "r1", message: "Went back to before the task", date: "2026-10-13T12:00:00.000Z" },
      { sha: "s0", message: "Start", date: "2026-10-13T09:00:00.000Z" },
    ],
  },
];

async function open(opts: { disabled?: boolean; language?: "en" | "es"; client?: FakeClient; actions?: Record<string, ActionOption> } = {}) {
  const client = opts.client ?? new FakeClient();
  if (!opts.client) client.historyGroups = groups;
  const onRestored = vi.fn();
  const onClose = vi.fn();
  const lang = opts.language ?? "en";
  await renderIn(lang, <HistoryPanel client={client} actions={opts.actions ?? actions} lang={lang} disabled={opts.disabled} onClose={onClose} onRestored={onRestored} />);
  return { client, onRestored, onClose };
}

describe("HistoryPanel", () => {
  it("filters the tasks by scope when the history has scopes", async () => {
    const client = new FakeClient();
    client.scopeList = [{ id: "fracciones", title: "Fractions", createdAt: "c", archived: false }];
    const group = (taskId: string, scopeId?: string) => ({
      taskId,
      actionId: null,
      ...(scopeId ? { scopeId } : {}),
      start: "s0",
      end: `e-${taskId}`,
      date: "2026-10-10T12:00:00.000Z",
      changes: [],
      entries: [{ sha: `e-${taskId}`, message: `Turn: ${taskId}`, date: "2026-10-10T12:00:00.000Z" }],
    });
    client.historyGroups = [group("t1", "fracciones"), group("t2", "_app"), group("t3")];
    await renderIn("en", <HistoryPanel client={client} actions={{}} lang="en" onClose={() => {}} />);
    const filter = (await screen.findByRole("combobox", { name: "Show" })) as HTMLSelectElement;
    await waitFor(() => expect([...filter.options].map((o) => o.textContent)).toEqual(["All", "Fractions", "App-wide"]));
    expect(screen.getAllByRole("button", { name: /A question/ })).toHaveLength(3);
    fireEvent.change(filter, { target: { value: "fracciones" } });
    expect(screen.getAllByRole("button", { name: /A question/ })).toHaveLength(1);
  });

  const scoped = (...rows: [string, string, string][]) => {
    const client = new FakeClient();
    client.scopeList = [{ id: "fracciones", title: "Fractions", createdAt: "c", archived: false }];
    client.historyGroups = rows.map(([taskId, scopeId, date]) => ({
      taskId,
      actionId: null,
      scopeId,
      start: "s0",
      end: `e-${taskId}`,
      date,
      changes: [],
      entries: [{ sha: `e-${taskId}`, message: `Turn: ${taskId}`, date }],
    }));
    return client;
  };

  it("counts the later tasks the scope filter hides when going back", async () => {
    const client = scoped(["t2", "_app", "2026-10-11T12:00:00.000Z"], ["t1", "fracciones", "2026-10-10T12:00:00.000Z"]);
    await renderIn("en", <HistoryPanel client={client} actions={{}} lang="en" onClose={() => {}} />);
    const filter = await screen.findByRole("combobox", { name: "Show" });
    await waitFor(() => expect(within(filter).getByRole("option", { name: "Fractions" })).toBeTruthy());
    fireEvent.change(filter, { target: { value: "fracciones" } });
    fireEvent.click(screen.getByRole("button", { name: /A question/ }));
    fireEvent.click(screen.getByRole("button", { name: "Go back to before this task" }));
    expect(screen.getByText(/This also undoes 1 later task\./)).toBeTruthy();
  });

  it("goes back to all when the selected scope is gone after a reload", async () => {
    const date = "2026-10-10T12:00:00.000Z";
    const first = scoped(["t1", "fracciones", date], ["t2", "other", date]);
    const i18n = await (await import("@humanharness/i18n")).createI18n("en");
    const ui = (c: FakeClient) => (
      <I18nextProvider i18n={i18n}>
        <HistoryPanel client={c} actions={{}} lang="en" onClose={() => {}} />
      </I18nextProvider>
    );
    const view = render(ui(first));
    const filter = (await screen.findByRole("combobox", { name: "Show" })) as HTMLSelectElement;
    await waitFor(() => expect(filter.options.length).toBe(3));
    fireEvent.change(filter, { target: { value: "fracciones" } });
    expect(screen.getAllByRole("button", { name: /A question/ })).toHaveLength(1);
    view.rerender(ui(scoped(["t2", "other", date], ["t3", "more", date])));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /A question/ })).toHaveLength(2));
    expect((screen.getByRole("combobox", { name: "Show" }) as HTMLSelectElement).value).toBe("");
  });

  it("shows no filter for a history without scopes", async () => {
    await renderIn("en", <HistoryPanel client={new FakeClient()} actions={{}} lang="en" onClose={() => {}} />);
    await screen.findByRole("heading", { name: "History" });
    expect(screen.queryByRole("combobox", { name: "Show" })).toBeNull();
  });

  it("shows one row per task with its action, note, date and files changed; the newest starts open", async () => {
    await open();
    const newest = await screen.findByRole("button", { name: /Plan the week.*The week.*2 files changed/ });
    expect(newest.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /A question.*1 file changed/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: /Other changes.*0 files changed/ }).getAttribute("aria-expanded")).toBe("false");
    const files = screen.getByRole("list", { name: "Changed files" });
    expect(within(files).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Deletedold.md", "Changedplan.md"]);
    expect(screen.getByText("Note saved: The week")).toBeTruthy();
    expect(screen.getByText("The AI finished")).toBeTruthy();
    expect(screen.getByText("Before your message")).toBeTruthy();
  });

  it("opens a row on click and shows its entries in plain language", async () => {
    await open();
    const row = await screen.findByRole("button", { name: /Other changes/ });
    // Only an open row points at its body.
    expect(row.getAttribute("aria-controls")).toBeNull();
    fireEvent.click(row);
    expect(document.getElementById(row.getAttribute("aria-controls") ?? "")).toBeTruthy();
    expect(screen.getByText("You went back to before this task")).toBeTruthy();
  });

  it("goes back to before a task after a confirmation", async () => {
    const { client, onRestored, onClose } = await open();
    fireEvent.click(await screen.findByRole("button", { name: "Go back to before this task" }));
    expect(screen.getByText("Go back to before this task? Everything it changed in your files will be undone.")).toBeTruthy();
    expect(screen.queryByText(/later task/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Yes, go back" }));
    await waitFor(() => expect(client.restoredTasks).toEqual(["t2"]));
    expect(onRestored).toHaveBeenCalledWith("task");
    expect(onClose).toHaveBeenCalled();
  });

  it("says when going back also undoes later tasks", async () => {
    await open();
    fireEvent.click(await screen.findByRole("button", { name: /A question/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "Go back to before this task" })[1]);
    expect(screen.getByText(/This also undoes 1 later task\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: /Other changes/ }));
    const points = screen.getAllByRole("button", { name: "Go back to this point" });
    // The oldest point, under both tasks.
    fireEvent.click(points[points.length - 1]);
    expect(screen.getByText(/This also undoes 2 later tasks\./)).toBeTruthy();
  });

  it("says it in Spanish too", async () => {
    await open({ language: "es" });
    fireEvent.click(await screen.findByRole("button", { name: /Otros cambios/ }));
    const points = screen.getAllByRole("button", { name: "Volver a este punto" });
    fireEvent.click(points[points.length - 1]);
    expect(screen.getByText(/Esto también deshace 2 tareas posteriores\./)).toBeTruthy();
  });

  it("focuses the yes when a confirmation opens, and gives focus back on Cancel", async () => {
    await open();
    const trigger = await screen.findByRole("button", { name: "Go back to before this task" });
    fireEvent.click(trigger);
    expect(document.activeElement?.textContent).toBe("Yes, go back");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Go back to before this task" }));
  });

  it("disables every way back while a restore is on its way", async () => {
    const client = new FakeClient();
    client.historyGroups = groups;
    let release!: () => void;
    client.restoreGate = new Promise((r) => (release = r));
    await open({ client });
    fireEvent.click(await screen.findByRole("button", { name: "Go back to before this task" }));
    const yes = screen.getByRole("button", { name: "Yes, go back" }) as HTMLButtonElement;
    fireEvent.click(yes);
    expect(yes.disabled).toBe(true);
    for (const b of screen.getAllByRole("button", { name: "Go back to this point" })) expect((b as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(yes);
    release();
    await waitFor(() => expect(client.restoredTasks).toEqual(["t2"]));
  });

  it("says so when the history can't be read, instead of showing it empty", async () => {
    const client = new FakeClient();
    client.historyError = new Error("disk");
    await open({ client });
    expect((await screen.findByRole("alert")).textContent).toBe("I couldn't read the history. Close it and try again.");
    expect(screen.queryByText("Nothing yet.")).toBeNull();
  });

  it("calls a task whose action the harness no longer has 'A task'", async () => {
    const client = new FakeClient();
    client.historyGroups = [
      { ...groups[0], taskId: "a", actionId: "gone" },
      { ...groups[1], taskId: "b", actionId: "toString" },
    ];
    await open({ client });
    expect(await screen.findAllByRole("button", { name: /^A task/ })).toHaveLength(2);
  });

  it("goes back to one point", async () => {
    const { client } = await open();
    fireEvent.click((await screen.findAllByRole("button", { name: "Go back to this point" }))[1]);
    fireEvent.click(screen.getByRole("button", { name: "Yes, go back" }));
    await waitFor(() => expect(client.restored).toEqual(["m2"]));
  });

  it("tells the window a point was restored", async () => {
    const { onRestored } = await open();
    fireEvent.click((await screen.findAllByRole("button", { name: "Go back to this point" }))[0]);
    fireEvent.click(screen.getByRole("button", { name: "Yes, go back" }));
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith("point"));
  });

  it("disables both kinds of going back while a turn is live", async () => {
    await open({ disabled: true });
    expect(((await screen.findByRole("button", { name: "Go back to before this task" })) as HTMLButtonElement).disabled).toBe(true);
    for (const b of screen.getAllByRole("button", { name: "Go back to this point" })) expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers no 'before this task' for the group outside any task", async () => {
    await open();
    fireEvent.click(await screen.findByRole("button", { name: /Other changes/ }));
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
