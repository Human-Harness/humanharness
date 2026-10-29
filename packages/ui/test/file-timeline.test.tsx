// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TimelineEntry } from "../src/client";
import { authorName, clock, FileTimeline, timeAgo } from "../src/FileTimeline";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const sha = (n: number) => n.toString(16).padStart(40, "0");
const at = (m: number) => new Date(Date.UTC(2026, 9, 28, 10, m)).toISOString();
const DOC = "specs/filter.md";
const entries: TimelineEntry[] = [
  { kind: "goBack", author: { kind: "person", label: "You" }, label: "", at: at(50), from: sha(6), to: sha(7), back: { version: 1 }, commits: [{ id: sha(7), subject: `Go back: ${DOC} to v1`, at: at(50) }] },
  { kind: "outside", author: { kind: "outside", label: "Outside the app" }, label: "", at: at(40), from: sha(5), to: sha(6), commits: [{ id: sha(6), subject: "Start", at: at(40) }] },
  { kind: "approval", author: { kind: "person", label: "You" }, label: "", at: at(30), from: sha(4), to: sha(5), version: 1, reason: true, commits: [{ id: sha(5), subject: `Approved: ${DOC}`, at: at(30) }] },
  { kind: "answers", author: { kind: "person", label: "You" }, label: "", at: at(20), from: sha(3), to: sha(4), unapproved: true, commits: [{ id: sha(4), subject: `Answer: ${DOC} · q`, at: at(20) }] },
  {
    kind: "task",
    author: { kind: "agent", label: "Spec writer", task: "t1", action: "spec" },
    label: "",
    at: at(10),
    from: sha(1),
    to: sha(3),
    commits: [
      { id: sha(3), subject: "Note: Filter", at: at(10) },
      { id: sha(2), subject: "Turn: write", at: at(9) },
    ],
  },
  { kind: "task", author: { kind: "agent", label: "A question", task: "t2" }, label: "", at: at(5), from: sha(0), to: sha(1), deleted: true, commits: [{ id: sha(1), subject: "Turn: q", at: at(5) }] },
];

describe("FileTimeline (file-timeline spec §6.1)", () => {
  it("shows each entry's author, text and chips, newest first", async () => {
    const client = new FakeClient();
    client.timelines[DOC] = entries;
    await renderIn("en", <FileTimeline client={client} path={DOC} />);
    const list = await screen.findByRole("list", { name: "Versions and changes" });
    const items = within(list).getAllByRole("listitem").filter((li) => li.parentElement === list);
    expect(items.map((li) => li.querySelector(".hh-timeline-author")?.textContent)).toEqual(["You", "Outside the app", "You", "You", "Spec writer", "A question"]);
    expect(items[0].textContent).toContain("You went back to v1");
    expect(items[1].textContent).toContain("Outside the app");
    expect(items[2].textContent).toContain("v1 approved, with a reason");
    expect(items[3].textContent).toContain("Your answers (1)");
    expect(items[3].textContent).toContain("not approved");
    expect(items[4].textContent).toContain("2 changes");
    expect(items[5].textContent).toContain("Deleted");
  });

  it("an entry expands into its turns; picking one calls onPick", async () => {
    const client = new FakeClient();
    client.timelines[DOC] = entries;
    const picked: string[] = [];
    await renderIn("en", <FileTimeline client={client} path={DOC} onPick={(e) => picked.push(e.to)} selected={sha(3)} />);
    fireEvent.click(await screen.findByRole("button", { name: "2 turns" }));
    expect(screen.getByText("Note saved: Filter")).toBeTruthy();
    expect(screen.getByText("The AI finished")).toBeTruthy();
    const current = screen.getByRole("button", { current: true });
    expect(current.textContent).toContain("Spec writer");
    fireEvent.click(screen.getAllByRole("button", { name: /Outside the app/ })[0]);
    expect(picked).toEqual([sha(6)]);
  });

  it("loading, empty, no history, and a new commit reloads it", async () => {
    const client = new FakeClient();
    await renderIn("en", <FileTimeline client={client} path="other.bin" />);
    expect(await screen.findByText("This file has no history.")).toBeTruthy();
    cleanup();
    client.timelines[DOC] = [];
    await renderIn("en", <FileTimeline client={client} path={DOC} />);
    expect(await screen.findByText("No history yet. It starts when the turn ends.")).toBeTruthy();
    client.timelines[DOC] = entries.slice(4, 5);
    client.emitFileCommit([DOC]);
    expect(await screen.findByText("Spec writer")).toBeTruthy();
  });

  it("timeAgo says how long ago, in the window's language", () => {
    const now = Date.parse(at(30));
    expect(timeAgo(at(10), "en", now)).toBe("20 minutes ago");
    expect(timeAgo(at(30), "en", now)).toBe("now");
  });

  it("a date that doesn't parse shows nothing instead of throwing", async () => {
    expect(timeAgo("not a date", "en")).toBe("");
    expect(clock("not a date", "en")).toBe("");
    const client = new FakeClient();
    client.timelines[DOC] = [{ ...entries[1], at: "not a date" }];
    await renderIn("en", <FileTimeline client={client} path={DOC} />);
    expect((await screen.findByRole("list", { name: "Versions and changes" })).textContent).toContain("Outside the app");
  });

  it("without onPick the list is read-only: entries are not buttons", async () => {
    const client = new FakeClient();
    client.timelines[DOC] = entries;
    await renderIn("en", <FileTimeline client={client} path={DOC} selected={sha(3)} />);
    await screen.findByRole("list", { name: "Versions and changes" });
    expect(screen.queryByRole("button", { name: /Spec writer/ })).toBeNull();
    expect(screen.getByText("Spec writer").closest("[aria-current]")?.tagName).toBe("DIV");
    expect(screen.getByRole("button", { name: "2 turns" })).toBeTruthy();
  });

  it("the chips use the timeline's own classes, not the start view's .hh-chip", async () => {
    const client = new FakeClient();
    client.timelines[DOC] = entries;
    const { container } = await renderIn("en", <FileTimeline client={client} path={DOC} />);
    await screen.findByRole("list", { name: "Versions and changes" });
    expect(container.querySelectorAll(".hh-chip").length).toBe(0);
    expect([...container.querySelectorAll(".hh-timeline-chip")].map((c) => c.className)).toEqual([
      "hh-timeline-chip hh-timeline-chip-grey",
      "hh-timeline-chip hh-timeline-chip-green",
      "hh-timeline-chip hh-timeline-chip-amber",
      "hh-timeline-chip hh-timeline-chip-grey",
    ]);
  });

  it("a reload that fails keeps the last good list", async () => {
    const client = new FakeClient();
    client.timelines[DOC] = entries;
    await renderIn("en", <FileTimeline client={client} path={DOC} />);
    await screen.findByText("Spec writer");
    let calls = 0;
    client.files = { ...client.files, timeline: async () => (calls++, { ok: false, reason: "failed" }) };
    await act(async () => client.emitFileCommit([DOC]));
    expect(calls).toBe(1);
    expect(screen.getByText("Spec writer")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("a tool's entry (tools spec §8.3)", () => {
  it("names the tool as the author, in a task or not", async () => {
    const client = new FakeClient();
    client.timelines[DOC] = [
      { kind: "task", author: { kind: "tool", label: "apply-triage", tool: "apply-triage", task: "t1", action: "spec" }, label: "", at: at(5), from: sha(0), to: sha(1), commits: [{ id: sha(1), subject: "Data: cards", at: at(5) }] },
    ];
    await renderIn("en", <FileTimeline client={client} path={DOC} />);
    const list = await screen.findByRole("list", { name: "Versions and changes" });
    expect(list.querySelector(".hh-timeline-author")?.textContent).toBe("apply-triage");
    expect(authorName((k) => k, { kind: "tool", label: "due-today", tool: "due-today" })).toBe("due-today");
  });
});
