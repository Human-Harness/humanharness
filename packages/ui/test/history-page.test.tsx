// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionOption, HistoryTaskView } from "../src/client";
import { HistoryPage, byDay, entryLabel } from "../src/HistoryPage";
import { HhTheme } from "../src/guide";
import { FakeClient } from "./fake-client";
import { renderIn as renderBase } from "./render";

/** History is built with Radix pieces that read the theme (Select). */
const renderIn = (language: string, ui: Parameters<typeof renderBase>[1]) => renderBase(language, ui, { theme: true });

afterEach(cleanup);

const actions = { plan: { label: "Plan the week", cost: "medium" as const } };
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

async function open(
  opts: {
    disabled?: boolean;
    client?: FakeClient;
    actions?: Record<string, ActionOption>;
    currentTask?: string;
    undoByFiles?: boolean;
    jobs?: { id: string; label: string }[];
  } = {},
) {
  const client = opts.client ?? new FakeClient();
  if (!opts.client) client.historyGroups = groups;
  const onRestored = vi.fn();
  const onClose = vi.fn();
  await renderIn(
    "en",
    <HistoryPage
      client={client}
      actions={opts.actions ?? actions}
      disabled={opts.disabled}
      currentTask={opts.currentTask}
      {...(opts.undoByFiles ? { undoByFiles: true } : {})}
      {...(opts.jobs ? { jobs: opts.jobs } : {})}
      onBack={onClose}
      onRestored={onRestored}
    />,
  );
  return { client, onRestored, onClose };
}

/** Picks `value` in the Radix select named `name`, from the keyboard. */
async function pick(name: string | RegExp, value: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name }), { key: "Enter" });
  fireEvent.keyDown(await screen.findByRole("option", { name: value }), { key: "Enter" });
}

describe("HistoryPage", () => {
  it("labels a job run's row with its job (Job: trailer); an unknown job is just a background job", async () => {
    const client = new FakeClient();
    const run = (taskId: string, jobId?: string): HistoryTaskView => ({
      taskId,
      actionId: null,
      ...(jobId ? { jobId } : {}),
      start: "s0",
      end: `e-${taskId}`,
      date,
      changes: [],
      entries: [{ sha: `e-${taskId}`, message: "Turn: sync", date }],
    });
    client.historyGroups = [run("r1", "sync"), run("r2", "gone"), run("r3", "toString"), run("t1")];
    await open({ client, jobs: [{ id: "sync", label: "Sync tickets" }] });
    expect(await screen.findByRole("button", { name: /Job · Sync tickets/ })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /A background job/ })).toHaveLength(2);
    // D0: a row without a Job: trailer is unchanged.
    expect(screen.getAllByRole("button", { name: /A question/ })).toHaveLength(1);
  });

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
    await renderIn("en", <HistoryPage client={client} actions={{}} onBack={() => {}} />);
    const filter = await screen.findByRole("combobox", { name: "Show" });
    await waitFor(() => expect(screen.getAllByRole("button", { name: /A question/ })).toHaveLength(3));
    fireEvent.keyDown(filter, { key: "Enter" });
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual(["All", "Fractions", "App-wide"]);
    fireEvent.keyDown(screen.getByRole("option", { name: "Fractions" }), { key: "Enter" });
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

  it("goes back from a filtered list (main counts the later tasks the filter hides)", async () => {
    const client = scoped(["t2", "_app", "2026-10-11T12:00:00.000Z"], ["t1", "fracciones", "2026-10-10T12:00:00.000Z"]);
    await renderIn("en", <HistoryPage client={client} actions={{}} onBack={() => {}} />);
    await screen.findByRole("combobox", { name: "Show" });
    await pick("Show", "Fractions");
    fireEvent.click(screen.getByRole("button", { name: /A question/ }));
    fireEvent.click(screen.getByRole("button", { name: "Undo this task" }));
    await waitFor(() => expect(client.restoredTasks).toEqual(["t1"]));
  });

  it("goes back to all when the selected scope is gone after a reload", async () => {
    const date = "2026-10-10T12:00:00.000Z";
    const first = scoped(["t1", "fracciones", date], ["t2", "other", date]);
    const i18n = await (await import("@humanharness/i18n")).createI18n("en");
    const ui = (c: FakeClient) => (
      <I18nextProvider i18n={i18n}>
        <HhTheme>
          <HistoryPage client={c} actions={{}} onBack={() => {}} />
        </HhTheme>
      </I18nextProvider>
    );
    const view = render(ui(first));
    await screen.findByRole("combobox", { name: "Show" });
    await pick("Show", "Fractions");
    expect(screen.getAllByRole("button", { name: /A question/ })).toHaveLength(1);
    view.rerender(ui(scoped(["t2", "other", date], ["t3", "more", date])));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /A question/ })).toHaveLength(2));
    expect(screen.getByRole("combobox", { name: "Show" }).textContent).toBe("All");
  });

  it("shows no filter for a history without scopes", async () => {
    await renderIn("en", <HistoryPage client={new FakeClient()} actions={{}} onBack={() => {}} />);
    await screen.findByRole("heading", { name: "History" });
    expect(screen.queryByRole("combobox", { name: "Show" })).toBeNull();
  });

  it("shows one row per task with its action, note, date and files changed; the newest starts open", async () => {
    await open();
    const newest = await screen.findByRole("button", { name: /Plan the week.*2 files changed.*Note saved/ });
    expect(newest.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /A question.*1 file changed/ }).getAttribute("aria-expanded")).toBe("false");
    const outside = screen.getByRole("button", { name: /Outside a task.*No changes/ });
    expect(outside.getAttribute("aria-expanded")).toBe("false");
    // Nothing changed outside a task: the gray tag alone, no "0 files changed".
    expect(outside.textContent).not.toMatch(/files? changed/);
    const files = screen.getByRole("list", { name: "Changed files" });
    expect(within(files).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Deletedold.md", "Changedplan.md"]);
    // The row tags a saved note; its title shows on hover.
    expect(screen.getByText("Note saved").getAttribute("title")).toBe("The week");
    expect(screen.getByText("Note saved: The week")).toBeTruthy();
    expect(screen.getByText("The AI finished")).toBeTruthy();
    expect(screen.getByText("Before your message")).toBeTruthy();
  });

  it("puts tasks under their day, and the changes outside any task last, under no day", async () => {
    const today = new Date();
    const at = (daysAgo: number, hour: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo, hour).toISOString();
    const client = new FakeClient();
    client.historyGroups = [
      { ...groups[0], date: at(0, 9) },
      { ...groups[1], date: at(1, 9) },
      { ...groups[2], date: at(0, 10) },
    ];
    await open({ client });
    await screen.findByRole("button", { name: /Plan the week/ });
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Today", "Yesterday"]);
    // Newer than both tasks, yet still last.
    const sections = [...document.querySelectorAll("ol.hh-gd-list")].map((l) => l.closest("section")!);
    expect(sections).toHaveLength(3);
    expect(sections[sections.length - 1].getAttribute("aria-label")).toBe("Outside a task");
  });

  it("groups by local day, keeping the order", () => {
    const g = (taskId: string, date: Date): HistoryTaskView => ({ ...groups[1], taskId, date: date.toISOString() });
    const days = byDay([g("a", new Date(2026, 9, 17, 18)), g("b", new Date(2026, 9, 17, 8)), g("c", new Date(2026, 9, 14, 23))]);
    expect(days.map((d) => [d.day.getDate(), d.items.map((i) => i.taskId)])).toEqual([
      [17, ["a", "b"]],
      [14, ["c"]],
    ]);
  });

  it("tags the open task's row as open now, and only that one", async () => {
    await open({ currentTask: "t1" });
    expect(await screen.findByRole("button", { name: /A question.*Open now/ })).toBeTruthy();
    expect(screen.getAllByText("Open now")).toHaveLength(1);
  });

  it("tags no row without an open task", async () => {
    await open();
    await screen.findByRole("button", { name: /Plan the week/ });
    expect(screen.queryByText("Open now")).toBeNull();
  });

  it("explains an empty history", async () => {
    const client = new FakeClient();
    client.historyGroups = [];
    await open({ client });
    expect(await screen.findByText("Nothing to go back to yet")).toBeTruthy();
    expect(screen.getByText("Each time the AI changes your files, a point shows here so you can undo it.")).toBeTruthy();
  });

  it("opens a row on click and shows its entries in plain language", async () => {
    await open();
    const row = await screen.findByRole("button", { name: /Outside a task/ });
    // Only an open row points at its body.
    expect(row.getAttribute("aria-controls")).toBeNull();
    fireEvent.click(row);
    expect(document.getElementById(row.getAttribute("aria-controls") ?? "")).toBeTruthy();
    expect(screen.getByText("You went back to before this task")).toBeTruthy();
  });

  it("shows a commit's part next to its text, and nothing for one without a part", async () => {
    const client = new FakeClient();
    client.historyGroups = [
      {
        ...groups[0],
        entries: [
          { sha: "m3", message: "Turn: go on", date, phase: "main" },
          { sha: "m2", message: "Turn: plan it", date },
          { sha: "m1", message: "Turn: gone", date, phase: "removed" },
        ],
      },
    ];
    const phased = { plan: { ...actions.plan, phases: [{ id: "warmup", label: "Warm-up" }, { id: "main", label: "Main block" }] } };
    await open({ client, actions: phased });
    const entries = await screen.findByRole("list", { name: "Points in this task" });
    const items = within(entries).getAllByRole("listitem");
    expect(within(items[0]).getByText("Main block")).toBeTruthy();
    expect(within(items[1]).queryByText("Main block")).toBeNull();
    expect(within(items[1]).queryByText("Warm-up")).toBeNull();
    expect(within(items[2]).queryByText("Main block")).toBeNull();
  });

  it("goes back to before a task once main confirms; the window draws no confirmation", async () => {
    const { client, onRestored, onClose } = await open();
    fireEvent.click(await screen.findByRole("button", { name: "Undo this task" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(client.restoredTasks).toEqual(["t2"]));
    expect(client.goBackAsks).toEqual([{ kind: "task", taskId: "t2" }]);
    expect(onRestored).toHaveBeenCalledWith("task");
    expect(onClose).toHaveBeenCalled();
  });

  it("undoing a task by its files (parallel spec §5.3) asks main's dialog and goes through like any undo", async () => {
    const client = new FakeClient();
    // t2 came later and changed q.md too: board mode never undoes it with t1 (main's dialog lists no later task).
    client.historyGroups = [{ ...groups[0], changes: [{ path: "q.md", kind: "modified" }] }, groups[1]];
    const { onRestored } = await open({ client, undoByFiles: true });
    fireEvent.click(await screen.findByRole("button", { name: /A question/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "Undo this task" })[1]);
    await waitFor(() => expect(client.restoredTasks).toEqual(["t1"]));
    expect(client.goBackAsks).toEqual([{ kind: "task", taskId: "t1" }]);
    expect(onRestored).toHaveBeenCalledWith("task");
  });

  it("says why main refused an undo by files, naming the file, and stays open", async () => {
    const client = new FakeClient();
    client.historyGroups = groups;
    client.restoreTaskRefusal = { reason: "later", path: "q.md", by: "task" };
    const { onRestored, onClose } = await open({ client, undoByFiles: true });
    fireEvent.click(await screen.findByRole("button", { name: /A question/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "Undo this task" })[1]);
    expect((await screen.findByRole("alert")).textContent).toBe("A later task also changed q.md, so this task can't be undone by itself.");
    expect(screen.queryByText("I couldn't go back to that point. Try again in a moment.")).toBeNull();
    expect(onRestored).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(client.restoredTasks).toEqual([]);
    // The way back is offered again; the next refusal replaces the line.
    client.restoreTaskRefusal = { reason: "running", path: "q.md" };
    const again = screen.getAllByRole("button", { name: "Undo this task" })[1] as HTMLButtonElement;
    await waitFor(() => expect(again.disabled).toBe(false));
    fireEvent.click(again);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Another task is changing q.md. Undo this one once that task waits."));
  });

  it("a Cancel in main's dialog is quiet: nothing changes, the panel stays, focus goes back to the button", async () => {
    const client = new FakeClient();
    client.historyGroups = groups;
    client.confirmGoBack = async () => false;
    const { onRestored, onClose } = await open({ client });
    const trigger = await screen.findByRole("button", { name: "Undo this task" });
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => expect(client.goBackAsks).toHaveLength(1));
    await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(client.restoredTasks).toEqual([]);
    expect(onRestored).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("disables every way back while a restore is on its way", async () => {
    const client = new FakeClient();
    client.historyGroups = groups;
    let release!: () => void;
    client.restoreGate = new Promise((r) => (release = r));
    await open({ client });
    const trigger = (await screen.findByRole("button", { name: "Undo this task" })) as HTMLButtonElement;
    fireEvent.click(trigger);
    expect(trigger.disabled).toBe(true);
    for (const b of screen.getAllByRole("button", { name: "Go back here" })) expect((b as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(trigger);
    release();
    await waitFor(() => expect(client.restoredTasks).toEqual(["t2"]));
  });

  it("says so when the history can't be read, instead of showing it empty", async () => {
    const client = new FakeClient();
    client.historyError = new Error("disk");
    await open({ client });
    expect((await screen.findByRole("alert")).textContent).toBe("I couldn't read the history. Go back and try again.");
    expect(screen.queryByText("Nothing to go back to yet")).toBeNull();
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
    fireEvent.click((await screen.findAllByRole("button", { name: "Go back here" }))[1]);
    await waitFor(() => expect(client.restored).toEqual(["m2"]));
    expect(client.goBackAsks).toEqual([{ kind: "point", sha: "m2" }]);
  });

  it("tells the window a point was restored", async () => {
    const { onRestored } = await open();
    fireEvent.click((await screen.findAllByRole("button", { name: "Go back here" }))[0]);
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith("point"));
  });

  it("disables both kinds of going back while a turn is live", async () => {
    await open({ disabled: true });
    expect(((await screen.findByRole("button", { name: "Undo this task" })) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("The AI is working. You can go back when it finishes.");
    for (const b of screen.getAllByRole("button", { name: "Go back here" })) expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers no 'before this task' for the group outside any task", async () => {
    await open();
    fireEvent.click(await screen.findByRole("button", { name: /Outside a task/ }));
    expect(screen.getByText("Started")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Undo this task" })).toHaveLength(1);
  });

  it("keeps an unknown subject as it is", () => {
    expect(entryLabel("Something else")).toBeNull();
    expect(entryLabel("Data: concepts")).toEqual({ key: "history.entry.data", values: { collection: "concepts" } });
    expect(entryLabel("Note: A title")).toEqual({ key: "history.entry.note", values: { title: "A title" } });
    expect(entryLabel("Stopped: hi")).toEqual({ key: "history.entry.stopped" });
  });

  it("opens at the task search asked for (search spec §3)", async () => {
    const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
    const g = (taskId: string, date: string) => ({ taskId, actionId: null, start: null, end: `e-${taskId}`, date, changes: [], entries: [{ sha: `e-${taskId}`, message: "Turn: hi", date }] });
    client.historyGroups = [g("t2", "2026-10-10T12:00:00.000Z"), g("t1", "2026-10-09T12:00:00.000Z")];
    await renderIn("en", <HistoryPage client={client} actions={{}} onBack={() => {}} openTask="t1" />);
    await waitFor(() => expect(screen.getAllByRole("button", { expanded: true }).map((b) => b.getAttribute("aria-controls"))).toEqual(["hh-history-t1"]));
  });
});

describe("changed files open their timeline (file-timeline spec §6.2)", () => {
  it("with onOpenFile, each changed file is a link that says which file and how it changed", async () => {
    const client = new FakeClient();
    client.historyGroups = groups;
    const opened: [string, string][] = [];
    await renderIn("en", <HistoryPage client={client} actions={actions} onBack={() => undefined} onOpenFile={(p, k) => opened.push([p, k])} />);
    const link = await screen.findByRole("button", { name: "History of plan.md" });
    // The change's kind is the link's description: a screen reader hears it with the name.
    const kind = document.getElementById(link.getAttribute("aria-describedby") ?? "");
    expect(kind?.textContent).toBe("Changed");
    expect(kind?.textContent).not.toBe("");
    fireEvent.click(link);
    fireEvent.click(screen.getByRole("button", { name: "History of old.md" }));
    expect(opened).toEqual([
      ["plan.md", "modified"],
      ["old.md", "deleted"],
    ]);
  });

  it("D0: without onOpenFile the paths stay plain text", async () => {
    const client = new FakeClient();
    client.historyGroups = groups;
    await renderIn("en", <HistoryPage client={client} actions={actions} onBack={() => undefined} />);
    await screen.findAllByText("plan.md");
    expect(screen.queryByRole("button", { name: "History of plan.md" })).toBeNull();
  });

  it("a one-file go-back reads in plain language", () => {
    expect(entryLabel("Go back: specs/a to b.md to v2")).toEqual({ key: "history.entry.fileBack", values: { file: "specs/a to b.md" } });
  });
});

describe("context changes in the history (context-panel spec §4.2)", () => {
  it("a Context: commit reads as one", () => {
    expect(entryLabel("Context: pinned docs/conv.md")).toEqual({ key: "history.entry.context", values: { change: "pinned docs/conv.md" } });
  });
});

describe("the History page (Radix stage 4b1)", () => {
  it("is a secondary page with the go-back line and an All / Tasks / Outside a task filter", async () => {
    const { onClose } = await open();
    await screen.findByRole("button", { name: /Plan the week/ });
    const title = screen.getByRole("heading", { level: 1, name: "History" });
    expect(document.activeElement).toBe(title);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Go back to any point: your files return to how they were then.")).toBeTruthy();
    const filter = screen.getByRole("radiogroup", { name: "Which turns to show" });
    const item = (name: string) => within(filter).getByRole("radio", { name });
    expect(item("All").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(item("Outside tasks"));
    expect(screen.queryByRole("button", { name: /Plan the week/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /A question/ })).toBeNull();
    // The gray tag stands alone: no "0 files changed" beside it.
    expect(screen.getByRole("button", { name: /Outside a task.*No changes/ }).textContent).not.toMatch(/files? changed/);
    fireEvent.click(item("Tasks"));
    expect(screen.getByRole("button", { name: /Plan the week/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Outside a task/ })).toBeNull();
    fireEvent.click(item("All"));
    expect(screen.getByRole("button", { name: /Outside a task.*No changes/ })).toBeTruthy();
    // Escape on the page goes back.
    fireEvent.keyDown(title, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("puts each day's tasks in one bordered list, with the status badges", async () => {
    await open({ currentTask: "t2" });
    const row = await screen.findByRole("button", { name: /Plan the week/ });
    expect(row.classList.contains("hh-history-row")).toBe(true);
    expect(row.closest("ol")?.classList.contains("hh-gd-list")).toBe(true);
    expect(screen.getByText("Open now")).toBeTruthy();
    expect(screen.getByText("Note saved")).toBeTruthy();
  });
});
