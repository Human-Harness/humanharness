// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatView } from "../src/ChatView";
import type { HistoryTaskView, TimelineEntry } from "../src/client";
import { FileTimelinePanel } from "../src/FileTimelinePanel";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const FILE = ".harness/reviews/specs/filter.md.json";
const A = "a".repeat(40);
const B = "b".repeat(40);
const entry: TimelineEntry = {
  kind: "task",
  author: { kind: "agent", label: "Spec writer", task: "t1", action: "spec" },
  label: "1 change",
  at: "2026-10-28T10:00:00.000Z",
  from: A,
  to: B,
  commits: [{ id: B, subject: "Turn: write", at: "2026-10-28T10:00:00.000Z" }],
};

describe("FileTimelinePanel (file-timeline spec §6.2)", () => {
  it("a dialog with the file's timeline; an entry opens its diff; back to the list; Esc closes", async () => {
    const client = new FakeClient();
    client.timelines[FILE] = [entry];
    client.diffs[`${FILE}|${A}|${B}`] = { ok: true, kind: "text", same: false, truncated: false, lang: "json", lines: [{ kind: "ins", text: "{}", new: 1 }] };
    let closed = 0;
    await renderIn("en", <FileTimelinePanel client={client} path={FILE} onClose={() => closed++} />);
    const dialog = screen.getByRole("dialog", { name: `History of ${FILE}` });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    const pick = await screen.findByRole("button", { name: /Spec writer/ });
    pick.focus();
    fireEvent.click(pick);
    expect((await screen.findByRole("region", { name: "Changes" })).textContent).toContain("{}");
    fireEvent.click(screen.getByRole("button", { name: "Back to the list" }));
    expect(await screen.findByRole("list", { name: "Versions and changes" })).toBeTruthy();
    // Focus goes back to the entry it came from.
    expect(document.activeElement).toBe(pick);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(closed).toBe(1);
  });
});

describe("the History panel's links in the window (file-timeline spec §6.2, Q10)", () => {
  const date = "2026-10-28T10:00:00.000Z";
  const groups: HistoryTaskView[] = [
    {
      taskId: "t1",
      actionId: null,
      start: "s0",
      end: "e1",
      date,
      changes: [
        { path: "gone.md", kind: "deleted" },
        { path: "plan.md", kind: "modified" },
        { path: FILE, kind: "added" },
      ],
      entries: [{ sha: "e1", message: "Turn: write", date }],
    },
  ];
  async function chat() {
    const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
    client.historyGroups = groups;
    client.docTexts["plan.md"] = "## Plan\n\nShip it.\n";
    for (const p of ["plan.md", "gone.md", FILE]) client.timelines[p] = [entry];
    await renderIn("en", <ChatView client={client} state={client.state} components={{}} stateBlocks={[]} />);
    return client;
  }
  const openLink = async (file: string) => {
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: `History of ${file}` }));
  };

  it("a `.md` that is still there opens in the reader with its drawer; the History panel closes, and one Esc doesn't close both", async () => {
    await chat();
    await openLink("plan.md");
    expect(screen.queryByRole("dialog", { name: "History" })).toBeNull();
    const reader = await screen.findByRole("complementary", { name: "Document" });
    const drawer = within(reader).getByRole("region", { name: "File history" });
    // The History panel closed before the reader opened: its document listener is gone, so one Esc is one step back.
    const pick = await within(drawer).findByRole("button", { name: /Spec writer/ });
    pick.focus();
    fireEvent.keyDown(pick, { key: "Escape" });
    expect(within(reader).queryByRole("region", { name: "File history" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Document" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "History" })).toBeNull();
  });

  it("a deleted `.md` and any other file open the timeline panel, not the reader", async () => {
    await chat();
    await openLink("gone.md");
    expect(screen.queryByRole("dialog", { name: "History" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "History of gone.md" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Document" })).toBeNull();
    await openLink(FILE);
    expect(screen.queryByRole("dialog", { name: "History of gone.md" })).toBeNull();
    const panel = screen.getByRole("dialog", { name: `History of ${FILE}` });
    expect(await within(panel).findByRole("button", { name: /Spec writer/ })).toBeTruthy();
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: `History of ${FILE}` })).toBeNull();
  });

  it("a document opened in the reader closes the timeline panel, which would cover it", async () => {
    const client = await chat();
    await openLink(FILE);
    expect(screen.getByRole("dialog", { name: `History of ${FILE}` })).toBeTruthy();
    act(() => client.openDocument("plan.md"));
    expect(await screen.findByRole("complementary", { name: "Document" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: `History of ${FILE}` })).toBeNull();
  });
});

describe("the file timeline drawer (UI refresh spec §5.7)", () => {
  it("renders in the drawer frame; Escape in a diff goes back to the list first; Tab stays inside", async () => {
    const client = new FakeClient();
    client.timelines[FILE] = [entry];
    client.diffs[`${FILE}|${A}|${B}`] = { ok: true, kind: "text", same: false, truncated: false, lang: "json", lines: [{ kind: "ins", text: "{}", new: 1 }] };
    let closed = 0;
    await renderIn("en", <FileTimelinePanel client={client} path={FILE} onClose={() => closed++} />);
    const dialog = screen.getByRole("dialog", { name: `History of ${FILE}` });
    expect(dialog.classList.contains("hh-drawer")).toBe(true);
    const pick = await within(dialog).findByRole("button", { name: /Spec writer/ });
    fireEvent.click(pick);
    await within(dialog).findByRole("region", { name: "Changes" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(closed).toBe(0);
    expect(await within(dialog).findByRole("list", { name: "Versions and changes" })).toBeTruthy();
    // Tab off the last control comes back to the first, the drawer's Close.
    const items = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled])")].filter((b) => !b.closest("[hidden]"));
    items[items.length - 1].focus();
    fireEvent.keyDown(items[items.length - 1], { key: "Tab" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(closed).toBe(1);
  });
});
