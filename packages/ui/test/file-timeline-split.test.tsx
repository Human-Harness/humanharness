// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatView } from "../src/ChatView";
import type { HistoryTaskView, TimelineEntry } from "../src/client";
import { FileTimelineSplit } from "../src/FileTimelineSplit";
import { FakeClient } from "./fake-client";
import { renderIn as renderBase } from "./render";

/** The chat's History is built with Radix pieces that read the theme. */
const renderIn = (language: string, ui: Parameters<typeof renderBase>[1]) => renderBase(language, ui, { theme: true });
/** The timeline's split view, outside the reader, and which file it shows. */
const split = () => document.querySelector<HTMLElement>("section.hh-split");

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

describe("FileTimelineSplit (file-timeline spec §6.2, Radix stage 4b1)", () => {
  it("a split view with the file's timeline; an entry opens its diff; back to the list; Esc closes", async () => {
    const client = new FakeClient();
    client.timelines[FILE] = [entry];
    client.diffs[`${FILE}|${A}|${B}`] = { ok: true, kind: "text", same: false, truncated: false, lang: "json", lines: [{ kind: "ins", text: "{}", new: 1 }] };
    let closed = 0;
    await renderIn("en", <FileTimelineSplit client={client} path={FILE} onClose={() => closed++} />);
    const view = screen.getByRole("region", { name: "File history" });
    expect(view.textContent).toContain(FILE);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2, name: "File history" }));
    const pick = await screen.findByRole("button", { name: /Spec writer/ });
    pick.focus();
    fireEvent.click(pick);
    expect((await screen.findByRole("region", { name: "Changes" })).textContent).toContain("{}");
    // The entry is hidden with the list: the focus moves to the way back, inside the split view.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back to the list" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to the list" }));
    expect(await screen.findByRole("list", { name: "Versions and changes" })).toBeTruthy();
    // Focus goes back to the entry it came from.
    expect(document.activeElement).toBe(pick);
    fireEvent.keyDown(view, { key: "Escape" });
    expect(closed).toBe(1);
  });

  it("Escape in a diff goes back to the list first; Close file history closes", async () => {
    const client = new FakeClient();
    client.timelines[FILE] = [entry];
    client.diffs[`${FILE}|${A}|${B}`] = { ok: true, kind: "text", same: false, truncated: false, lang: "json", lines: [{ kind: "ins", text: "{}", new: 1 }] };
    let closed = 0;
    await renderIn("en", <FileTimelineSplit client={client} path={FILE} onClose={() => closed++} />);
    const view = screen.getByRole("region", { name: "File history" });
    fireEvent.click(await within(view).findByRole("button", { name: /Spec writer/ }));
    await within(view).findByRole("region", { name: "Changes" });
    fireEvent.keyDown(view, { key: "Escape" });
    expect(closed).toBe(0);
    expect(await within(view).findByRole("list", { name: "Versions and changes" })).toBeTruthy();
    fireEvent.click(within(view).getByRole("button", { name: "Close file history" }));
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

  it("a `.md` that is still there opens in the reader with its drawer; the History page closes, and one Esc doesn't close both", async () => {
    await chat();
    await openLink("plan.md");
    expect(screen.queryByRole("heading", { level: 1, name: "History" })).toBeNull();
    const reader = await screen.findByRole("complementary", { name: "Document" });
    const drawer = within(reader).getByRole("region", { name: "File history" });
    // The History panel closed before the reader opened: its document listener is gone, so one Esc is one step back.
    const pick = await within(drawer).findByRole("button", { name: /Spec writer/ });
    pick.focus();
    fireEvent.keyDown(pick, { key: "Escape" });
    expect(within(reader).queryByRole("region", { name: "File history" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Document" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: "History" })).toBeNull();
  });

  it("a deleted `.md` and any other file open the timeline split view, not the reader", async () => {
    await chat();
    await openLink("gone.md");
    expect(screen.queryByRole("heading", { level: 1, name: "History" })).toBeNull();
    expect(split()?.textContent).toContain("gone.md");
    expect(screen.queryByRole("complementary", { name: "Document" })).toBeNull();
    // The chat shows again, with the split view beside it.
    expect(split()?.closest(".hh-body")?.classList.contains("hh-with-reader")).toBe(true);
    await openLink(FILE);
    expect(split()?.textContent).not.toContain("gone.md");
    expect(split()?.textContent).toContain(FILE);
    expect(await within(split()!).findByRole("button", { name: /Spec writer/ })).toBeTruthy();
    fireEvent.keyDown(split()!, { key: "Escape" });
    expect(split()).toBeNull();
  });

  it("a document opened in the reader closes the timeline split view: one split view at a time", async () => {
    const client = await chat();
    await openLink(FILE);
    expect(split()).toBeTruthy();
    act(() => client.openDocument("plan.md"));
    expect(await screen.findByRole("complementary", { name: "Document" })).toBeTruthy();
    expect(split()).toBeNull();
  });
});
