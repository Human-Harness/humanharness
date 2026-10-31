// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskContext } from "../src/client";
import { ContextPanel } from "../src/ContextPanel";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const AT = "2026-10-28T10:00:00.000Z";
const CTX: TaskContext = {
  task: "t1",
  scope: "main",
  scoped: false,
  start: [
    { id: "instructions", kind: "instructions", label: "Harness instructions", path: "AGENTS.md", tokens: 1200 },
    { id: "brief", kind: "brief", label: "Task brief", tokens: 300 },
    { id: "notes", kind: "notes-index", label: "Notes (1)", tokens: 400, count: 1, notes: [{ path: ".harness/notes/q-redux.md", title: "We use Redux" }], compacted: true },
    { id: "data:tickets", kind: "data", label: "Data · tickets (12 rows)", tokens: 800, count: 12 },
  ],
  startTokens: 6312,
  reads: [
    { kind: "read", label: "docs/old.md", path: "docs/old.md", firstAt: "2026-10-28T10:01:00.000Z", count: 1, compacted: true },
    { kind: "read", label: "src/app.ts", path: "src/app.ts", firstAt: "2026-10-28T10:05:00.000Z", count: 3 },
    { kind: "tool", label: "atlassian · getJiraIssue", firstAt: "2026-10-28T10:03:00.000Z", count: 1 },
  ],
  compacted: true,
  pins: [
    { scope: "main", path: "conventions.md", at: AT, state: "full", tokens: 500 },
    { scope: "main", path: "docs/arch.md", at: AT, state: "title", tokens: 9000 },
    { scope: "main", path: "gone.md", at: AT, state: "missing", tokens: 0 },
  ],
  excluded: [{ scope: "main", note: ".harness/notes/q-old.md", at: AT, title: "Old idea" }],
  budget: 3000,
};

async function show(props: Partial<Parameters<typeof ContextPanel>[0]> = {}, ctx: TaskContext = CTX) {
  const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
  client.contexts.t1 = ctx;
  const onOpen = vi.fn();
  await renderIn("en", <ContextPanel client={client} taskId="t1" usage={{ used: 40_000, cap: 200_000 }} onOpen={onOpen} onClose={() => {}} {...props} />);
  const panel = await screen.findByRole("region", { name: "What the AI takes into account" });
  await within(panel).findByRole("heading", { name: "At the start" });
  return { client, panel, onOpen };
}

describe("ContextPanel (context-panel spec §5.1)", () => {
  it("shows the start with sizes, the total, the real first turn and the meter's numbers", async () => {
    const { panel } = await show();
    const start = within(panel).getByRole("region", { name: "At the start" });
    expect(within(start).getByText("Harness instructions")).toBeTruthy();
    expect(within(start).getByText("approx. 1,200 tokens")).toBeTruthy();
    expect(within(start).getByText("Data · tickets (12 rows)")).toBeTruthy();
    expect(within(start).getByText("Total: approx. 2,700 tokens")).toBeTruthy();
    expect(within(start).getByText("First turn: 6,312 tokens (real)")).toBeTruthy();
    expect(within(panel).getByText("In use now: 40,000 of 200,000 tokens")).toBeTruthy();
  });

  it("lists reads and tools newest first with counts; what came before a compaction is faint", async () => {
    const { panel } = await show();
    const during = within(panel).getByRole("region", { name: "During the task" });
    const rows = within(during).getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(rows[0]).toContain("src/app.ts");
    expect(rows[0]).toContain("×3");
    expect(rows[1]).toContain("atlassian · getJiraIssue");
    expect(rows[2]).toContain("docs/old.md");
    expect(rows[2]).toContain("may be summarized");
  });

  it("pins over the budget say title only; a missing one is struck through with Remove", async () => {
    const { panel, client } = await show();
    const pinned = within(panel).getByRole("region", { name: "Pinned" });
    expect(within(pinned).getByText("title only")).toBeTruthy();
    // Only a whole pin shows its size: a title-only one costs a line, not the file's 9,000.
    expect(within(pinned).getByText("approx. 500 tokens")).toBeTruthy();
    expect(within(pinned).queryByText(/9,000/)).toBeNull();
    expect(within(pinned).getByText("gone.md").closest(".hh-ctxp-gone")).toBeTruthy();
    fireEvent.click(within(pinned).getByRole("button", { name: "Remove gone.md" }));
    await waitFor(() => expect(client.contextCalls).toContainEqual({ op: "unpin", args: ["main", "gone.md"] }));
  });

  it("Exclude a listed note, Pin a read, Include again an excluded note", async () => {
    const { panel, client } = await show();
    const start = within(panel).getByRole("region", { name: "At the start" });
    fireEvent.click(within(start).getByRole("button", { name: "Exclude We use Redux" }));
    const during = within(panel).getByRole("region", { name: "During the task" });
    fireEvent.click(within(during).getByRole("button", { name: "Pin src/app.ts" }));
    const excluded = within(panel).getByRole("region", { name: "Excluded" });
    fireEvent.click(within(excluded).getByRole("button", { name: "Include again Old idea" }));
    await waitFor(() =>
      expect(client.contextCalls).toEqual([
        { op: "exclude", args: ["main", ".harness/notes/q-redux.md"] },
        { op: "pin", args: ["main", "src/app.ts"] },
        { op: "include", args: ["main", ".harness/notes/q-old.md"] },
      ]),
    );
  });

  it("a note already excluded says it applies from the next task", async () => {
    const { panel } = await show({}, { ...CTX, excluded: [{ scope: "main", note: ".harness/notes/q-redux.md", at: AT, title: "We use Redux" }] });
    const start = within(panel).getByRole("region", { name: "At the start" });
    expect(within(start).getByText("Applies from the next task")).toBeTruthy();
    expect(within(start).queryByRole("button", { name: "Exclude We use Redux" })).toBeNull();
  });

  it("Add…: a picked file goes to this task, Waiting while it waits; a refused pin says why", async () => {
    const { panel, client } = await show();
    client.pickAnswer = { ok: true, path: "docs/conv.md" };
    let release!: () => void;
    client.contextGate = new Promise<void>((r) => (release = r));
    fireEvent.click(within(panel).getByRole("button", { name: "Add…" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Choose a file…" }));
    await within(panel).findByText("docs/conv.md");
    fireEvent.click(within(panel).getByRole("button", { name: "For this task" }));
    expect(await within(panel).findByText("Waiting for the current turn to end…")).toBeTruthy();
    await act(async () => release());
    await waitFor(() => expect(within(panel).queryByText("Waiting for the current turn to end…")).toBeNull());
    expect(client.contextCalls).toContainEqual({ op: "add", args: ["t1", "docs/conv.md"] });

    client.contextGate = null;
    client.contextAnswer = { ok: false, reason: "binary" };
    fireEvent.click(within(panel).getByRole("button", { name: "Add…" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Choose a file…" }));
    await within(panel).findByText("docs/conv.md");
    fireEvent.click(within(panel).getByRole("button", { name: "Pin for every new task" }));
    expect(await within(panel).findByText("Text files only")).toBeTruthy();
  });

  it("Add… offers the scope's notes too", async () => {
    const notes = [{ slug: "q-a", title: "Fractions so far", date: AT, summary: [], decisions: [], path: ".harness/notes/q-a.md" }];
    const { panel } = await show({ notes });
    fireEvent.click(within(panel).getByRole("button", { name: "Add…" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Fractions so far" }));
    expect(await within(panel).findByText(".harness/notes/q-a.md")).toBeTruthy();
  });

  it("opens an item's file; read-only has no action; a live change replaces the view", async () => {
    const { panel, onOpen, client } = await show();
    fireEvent.click(within(panel).getByRole("button", { name: "conventions.md" }));
    expect(onOpen).toHaveBeenCalledWith("conventions.md");
    act(() => client.emitContext("t1", { ...CTX, reads: [] }));
    await waitFor(() => expect(within(panel).queryByText("src/app.ts")).toBeNull());
    cleanup();
    const ro = await show({ readOnly: true });
    expect(within(ro.panel).queryByRole("button", { name: "Add…" })).toBeNull();
    expect(within(ro.panel).queryByRole("button", { name: /^Pin / })).toBeNull();
  });

  it("a name the agent can't be given says why", async () => {
    const { panel, client } = await show();
    client.contextAnswer = { ok: false, reason: "bad-name" };
    fireEvent.click(within(panel).getByRole("button", { name: "Pin src/app.ts" }));
    expect(await within(panel).findByText("File names with a backtick or a line break can't be used.")).toBeTruthy();
  });

  it("the Add… menu: Escape closes it and gives focus back to Add…", async () => {
    const { panel } = await show();
    const add = within(panel).getByRole("button", { name: "Add…" });
    fireEvent.click(add);
    const choose = within(panel).getByRole("button", { name: "Choose a file…" });
    await waitFor(() => expect(document.activeElement).toBe(choose));
    fireEvent.keyDown(choose, { key: "Escape" });
    expect(within(panel).queryByRole("button", { name: "Choose a file…" })).toBeNull();
    expect(document.activeElement).toBe(add);
    expect(within(panel).getByRole("heading", { name: "At the start" })).toBeTruthy();
  });

  it("another task: nothing of the previous one carries over; a no-task answer clears the view", async () => {
    const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
    client.contexts.t1 = CTX;
    client.contexts.t2 = { ...CTX, task: "t2", reads: [{ kind: "read", label: "src/two.ts", path: "src/two.ts", firstAt: AT, count: 1 }] };
    client.pickAnswer = { ok: true, path: "docs/conv.md" };
    const { rerender, i18n } = await renderIn("en", <ContextPanel client={client} taskId="t1" />);
    const wrap = (id: string) => (
      <I18nextProvider i18n={i18n}>
        <ContextPanel client={client} taskId={id} />
      </I18nextProvider>
    );
    await screen.findByText("src/app.ts");
    fireEvent.click(screen.getByRole("button", { name: "Add…" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose a file…" }));
    await screen.findByText("docs/conv.md");
    rerender(wrap("t2"));
    await screen.findByText("src/two.ts");
    expect(screen.queryByText("src/app.ts")).toBeNull();
    expect(screen.queryByText("docs/conv.md")).toBeNull();
    expect(screen.queryByRole("button", { name: "For this task" })).toBeNull();
    rerender(wrap("t9"));
    expect(await screen.findByText("No task is open.")).toBeTruthy();
    expect(screen.queryByText("src/two.ts")).toBeNull();
  });

  it("a late answer for the previous task is dropped", async () => {
    const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
    client.contexts.t1 = CTX;
    client.contexts.t2 = { ...CTX, task: "t2", reads: [{ kind: "read", label: "src/two.ts", path: "src/two.ts", firstAt: AT, count: 1 }] };
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    client.context.pin = async () => {
      await gate;
      return { ok: false, reason: "binary" };
    };
    const { rerender, i18n } = await renderIn("en", <ContextPanel client={client} taskId="t1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Pin src/app.ts" }));
    rerender(
      <I18nextProvider i18n={i18n}>
        <ContextPanel client={client} taskId="t2" />
      </I18nextProvider>,
    );
    await screen.findByText("src/two.ts");
    await act(async () => release());
    expect(screen.queryByText("Text files only")).toBeNull();
    expect(screen.getByText("src/two.ts")).toBeTruthy();
  });

  it("after Exclude, Remove or Include again, focus lands on the section, or on Add… when the section goes", async () => {
    const { panel } = await show();
    fireEvent.click(within(panel).getByRole("button", { name: "Exclude We use Redux" }));
    await waitFor(() => expect(document.activeElement).toBe(within(panel).getByRole("heading", { name: "At the start" })));
    fireEvent.click(within(panel).getByRole("button", { name: "Remove gone.md" }));
    await waitFor(() => expect(document.activeElement).toBe(within(panel).getByRole("heading", { name: "Pinned" })));
    fireEvent.click(within(panel).getByRole("button", { name: "Include again Old idea" }));
    await waitFor(() => expect(document.activeElement).toBe(within(panel).getByRole("button", { name: "Add…" })));
  });

  it("keeps the status region mounted, empty until something waits", async () => {
    const { panel } = await show();
    expect(within(panel).getByRole("status").textContent).toBe("");
  });

  it("two reads with the same name outside the folder both show, with no key clash", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const reads = [
      { kind: "read" as const, label: "notes.md", firstAt: "2026-10-28T10:01:00.000Z", count: 1 },
      { kind: "read" as const, label: "notes.md", firstAt: "2026-10-28T10:02:00.000Z", count: 1 },
    ];
    const { panel } = await show({}, { ...CTX, reads });
    const during = within(panel).getByRole("region", { name: "During the task" });
    expect(within(during).getAllByText("notes.md")).toHaveLength(2);
    expect(errors.mock.calls.some((c) => String(c[0]).includes("same key"))).toBe(false);
    errors.mockRestore();
  });

  it("says when there is no open task", async () => {
    const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
    await renderIn("en", <ContextPanel client={client} taskId="t9" />);
    expect(await screen.findByText("No task is open.")).toBeTruthy();
  });
});

describe("the context panel's frame (UI refresh spec §5.7)", () => {
  it("wears the drawer's header but stays docked beside the chat: a region, not a modal", async () => {
    const { panel } = await show();
    expect(panel.getAttribute("aria-modal")).toBeNull();
    const head = panel.querySelector(".hh-drawer-head");
    expect(head?.querySelector("h2")?.textContent).toBe("What the AI takes into account");
    expect(within(head as HTMLElement).getByRole("button", { name: "Close" })).toBeTruthy();
  });
});
