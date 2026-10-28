// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AppState, HistoryTaskView } from "../src/client";
import { HistoryPanel } from "../src/HistoryPanel";
import { ScopePicker } from "../src/ScopePicker";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const linkedFolders = {
  repos: { label: "Repos", mode: "write" as const, history: "auto" as const, many: true },
  notes: { label: "Notes", mode: "write" as const, history: "auto" as const, many: false },
};

function scoped(hatches = true) {
  const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" });
  client.state.scopes = { label: "project", plural: "projects" };
  if (hatches) client.state.hatches = { linkedFolders };
  client.scopeList = [{ id: "app", title: "App", createdAt: "c", archived: false }];
  client.openScope = "app";
  return client;
}

const picker = (client: FakeClient, state: AppState = client.state) => renderIn("en", <ScopePicker client={client} state={state} open="app" />);

async function openSettings(client: FakeClient) {
  await picker(client);
  fireEvent.click(await screen.findByRole("button", { name: "App settings" }));
  return screen.findByRole("dialog", { name: "App settings" });
}

const task = (taskId: string): HistoryTaskView => ({
  taskId,
  actionId: null,
  start: "s0",
  end: `e-${taskId}`,
  date: "2026-10-13T11:00:00.000Z",
  changes: [{ path: "main.md", kind: "modified" }],
  entries: [{ sha: `e-${taskId}`, message: "Turn: go", date: "2026-10-13T11:00:00.000Z" }],
});

describe("Scope settings › Linked folders (hatches spec §3.2)", () => {
  it("D0: no settings button and no linked lines without state.hatches", async () => {
    const client = scoped(false);
    client.historyGroups = [task("t1")];
    client.linkedHistoryAnswer = { uncovered: [{ key: "repos", label: "Repos" }], tasks: {} };
    await picker(client);
    await screen.findByRole("combobox", { name: "Choose project" });
    expect(screen.queryByRole("button", { name: /settings/i })).toBeNull();
    cleanup();
    await renderIn("en", <HistoryPanel client={client} actions={{}} onClose={() => undefined} />);
    await screen.findByRole("button", { name: /A question/ });
    expect(screen.queryByText(/Undo doesn't cover/)).toBeNull();
    expect(client.scopes.linkedHistory).not.toHaveBeenCalled();
    expect(client.scopes.linked).not.toHaveBeenCalled();
  });

  it("shows no settings button while no scope is open", async () => {
    const client = scoped();
    await renderIn("en", <ScopePicker client={client} state={client.state} open={null} />);
    await screen.findByRole("combobox", { name: "Choose project" });
    expect(screen.queryByRole("button", { name: /settings/i })).toBeNull();
  });

  it("lists the scope's links with their kind, mode and history", async () => {
    const client = scoped();
    client.linkedSet("app", [{ key: "repos", label: "Repos", path: "/code/app", mode: "write", tracked: false }]);
    const dialog = await openSettings(client);
    expect(await within(dialog).findByText("/code/app")).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "Linked folders" })).toBeTruthy();
    expect(within(dialog).getAllByText("Repos").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("Read and write")).toBeTruthy();
    expect(within(dialog).getByText("Has its own git")).toBeTruthy();
    const unlink = within(dialog).getByRole("button", { name: "Unlink" });
    expect(unlink.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(unlink.getAttribute("aria-describedby")!)?.textContent).toContain("/code/app");
    fireEvent.click(unlink);
    await waitFor(() => expect(client.scopes.unlinkFolder).toHaveBeenCalledWith("app", "repos", "/code/app"));
    await waitFor(() => expect(within(dialog).queryByText("/code/app")).toBeNull());
  });

  it("shows a read folder as read only with no history line, beside a tracked write folder", async () => {
    const client = scoped();
    client.linkedSet("app", [{ key: "notes", label: "Notes", path: "/n", mode: "write", tracked: true }, { key: "repos", label: "Repos", path: "/r", mode: "read", tracked: false }]);
    const dialog = await openSettings(client);
    expect(await within(dialog).findByText("Tracked by the app's history")).toBeTruthy();
    expect(within(dialog).getByText("Read only")).toBeTruthy();
    // A read folder is never tracked and never has a history line (Decision 2).
    expect(within(dialog).queryByText("Has its own git")).toBeNull();
  });

  it("Link a folder… per declared key; a refusal shows its sentence and focuses it", async () => {
    const client = scoped();
    client.linkPickAnswer = { refused: "engine-home" };
    const dialog = await openSettings(client);
    expect(await within(dialog).findByRole("button", { name: "Link a folder… (Notes)" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Link a folder… (Repos)" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toBe("This folder holds an app's settings or keys, so it can't be linked.");
    expect(client.scopes.linkFolder).toHaveBeenCalledWith("app", "repos");
    await waitFor(() => expect(document.activeElement).toBe(alert));
  });

  it("names the scope in the other-scope refusal", async () => {
    const client = scoped();
    client.linkPickAnswer = { refused: "other-scope-write" };
    const dialog = await openSettings(client);
    fireEvent.click(await within(dialog).findByRole("button", { name: "Link a folder… (Repos)" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Another project already changes this folder, or a folder inside or around it.");
  });

  it("a picked folder shows in the list; a cancelled pick changes nothing", async () => {
    const client = scoped();
    const dialog = await openSettings(client);
    fireEvent.click(await within(dialog).findByRole("button", { name: "Link a folder… (Repos)" }));
    await waitFor(() => expect(client.scopes.linkFolder).toHaveBeenCalledTimes(1));
    expect(within(dialog).queryByRole("alert")).toBeNull();
    client.linkPickAnswer = { path: "/code/web", label: "Repos" };
    fireEvent.click(within(dialog).getByRole("button", { name: "Link a folder… (Repos)" }));
    expect(await within(dialog).findByText("/code/web")).toBeTruthy();
  });

  it("a one-only key hides its link button once linked", async () => {
    const client = scoped();
    client.linkedSet("app", [{ key: "notes", label: "Notes", path: "/n", mode: "write", tracked: true }]);
    const dialog = await openSettings(client);
    await within(dialog).findByText("/n");
    expect(within(dialog).queryByRole("button", { name: "Link a folder… (Notes)" })).toBeNull();
    // A many key keeps its button.
    expect(within(dialog).getByRole("button", { name: "Link a folder… (Repos)" })).toBeTruthy();
  });

  it("a git change asks: Track with the app's history / Leave to its own git", async () => {
    const client = scoped();
    // Lost git: both answers work (a folder with no git may be tracked).
    client.linkedSet("app", [{ key: "repos", label: "Repos", path: "/r", mode: "write", tracked: false, gitChanged: true }]);
    const dialog = await openSettings(client);
    expect(await within(dialog).findByText("This folder no longer has git.")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Track with the app's history" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Leave to its own git" }));
    await waitFor(() => expect(client.scopes.confirmGit).toHaveBeenCalledWith("app", "repos", "/r", false));
    await waitFor(() => expect(within(dialog).queryByText("This folder no longer has git.")).toBeNull());
  });

  it("a folder that gained git can only be left to its own git (main refuses tracking a git folder)", async () => {
    const client = scoped();
    client.linkedSet("app", [{ key: "repos", label: "Repos", path: "/r", mode: "write", tracked: true, gitChanged: true }]);
    const dialog = await openSettings(client);
    expect(await within(dialog).findByText("This folder now has its own git.")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Track with the app's history" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Leave to its own git" }));
    await waitFor(() => expect(client.scopes.confirmGit).toHaveBeenCalledWith("app", "repos", "/r", false));
  });

  it("an action that fails says so", async () => {
    const client = scoped();
    client.linkedSet("app", [{ key: "repos", label: "Repos", path: "/r", mode: "write", tracked: false }]);
    client.scopes.unlinkFolder.mockRejectedValueOnce(new Error("no"));
    const dialog = await openSettings(client);
    fireEvent.click(await within(dialog).findByRole("button", { name: "Unlink" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("That didn't work. Try again.");
  });

  it("shows the Codex line when the engine can't take linked folders", async () => {
    const client = scoped();
    client.linkedUnsupported = true;
    const dialog = await openSettings(client);
    expect(await within(dialog).findByText("Linked folders don't work with this version of Codex yet.")).toBeTruthy();
  });

  it("Escape closes the dialog and focus returns to the button", async () => {
    const client = scoped();
    await openSettings(client);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "App settings" }));
  });
});

describe("History panel with linked folders", () => {
  it("says undo doesn't cover an untracked folder, and lists a task's linked changes under the folder's label", async () => {
    const client = scoped();
    client.historyGroups = [task("t1")];
    client.linkedHistoryAnswer = {
      uncovered: [{ key: "repos", label: "Repos" }],
      tasks: { t1: [{ key: "notes", label: "Notes", changes: [{ path: "todo.md", kind: "added" }] }] },
    };
    await renderIn("en", <HistoryPanel client={client} actions={{}} linkedFolders={linkedFolders} onClose={() => undefined} onOpenFile={() => undefined} />);
    expect(await screen.findByText("Repos: Undo doesn't cover this folder: it has its own git.")).toBeTruthy();
    expect(screen.getAllByText(/Undo doesn't cover/)).toHaveLength(1);
    const files = await screen.findByRole("list", { name: "Notes" });
    expect(within(files).getByText("todo.md")).toBeTruthy();
    // Plain text: the file timeline reads only the main folder's history.
    expect(within(files).queryByRole("button")).toBeNull();
  });

  it("a failed linked history shows nothing extra", async () => {
    const client = scoped();
    client.historyGroups = [task("t1")];
    client.scopes.linkedHistory.mockRejectedValueOnce(new Error("no"));
    await renderIn("en", <HistoryPanel client={client} actions={{}} linkedFolders={linkedFolders} onClose={() => undefined} />);
    await screen.findByRole("button", { name: /A question/ });
    await waitFor(() => expect(client.scopes.linkedHistory).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("hides the 'not covered' lines while the scope filter shows another scope", async () => {
    const client = scoped();
    client.scopeList = [...client.scopeList, { id: "web", title: "Web", createdAt: "c", archived: false }];
    client.historyGroups = [{ ...task("t1"), scopeId: "app" }, { ...task("t2"), scopeId: "web" }];
    client.linkedHistoryAnswer = { uncovered: [{ key: "repos", label: "Repos" }], tasks: {} };
    await renderIn("en", <HistoryPanel client={client} actions={{}} linkedFolders={linkedFolders} onClose={() => undefined} />);
    expect(await screen.findByText(/Undo doesn't cover/)).toBeTruthy();
    const filter = screen.getByRole("combobox");
    fireEvent.change(filter, { target: { value: "web" } });
    await waitFor(() => expect(screen.queryByText(/Undo doesn't cover/)).toBeNull());
    fireEvent.change(filter, { target: { value: "app" } });
    expect(await screen.findByText(/Undo doesn't cover/)).toBeTruthy();
  });

  it("a partial undo says what was undone and which folder wasn't, and why", async () => {
    const client = scoped();
    client.historyGroups = [task("t1")];
    client.restoreTaskRefusal = {
      reason: "partial",
      workFolder: true,
      restored: ["repos"],
      notRestored: ["notes", "repos"],
      cause: { reason: "running", path: "notes/todo.md" },
    };
    await renderIn("en", <HistoryPanel client={client} actions={{}} linkedFolders={linkedFolders} undoByFiles onClose={() => undefined} />);
    const loads = client.scopes.linkedHistory.mock.calls.length;
    fireEvent.click(await screen.findByRole("button", { name: "Undo this task" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Undone in your work folder and Repos. Not undone in Notes: Another task is changing notes/todo.md. Undo this one once that task waits.",
    );
    // Part of the task went back: the panel reads the history again.
    await waitFor(() => expect(client.scopes.linkedHistory.mock.calls.length).toBeGreaterThan(loads));
  });

  it("a partial undo with nothing taken back says only what wasn't", async () => {
    const client = scoped();
    client.historyGroups = [task("t1")];
    client.restoreTaskRefusal = { reason: "partial", workFolder: false, restored: [], notRestored: ["gone"], cause: { reason: "uncommitted", path: "gone/a.md" } };
    await renderIn("en", <HistoryPanel client={client} actions={{}} linkedFolders={linkedFolders} undoByFiles onClose={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Undo this task" }));
    // A key the manifest no longer declares shows as its key.
    expect((await screen.findByRole("alert")).textContent).toMatch(/^Not undone in gone: /);
  });
});
