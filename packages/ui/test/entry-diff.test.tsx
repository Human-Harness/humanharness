// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";
import { ChatView } from "../src/ChatView";
import type { TimelineEntry } from "../src/client";
import { EntryDiff } from "../src/EntryDiff";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const A = "a".repeat(40);
const B = "b".repeat(40);
const DOC = "specs/filter.md";
const entry: TimelineEntry = {
  kind: "task",
  author: { kind: "agent", label: "Spec writer", task: "t1", action: "spec" },
  label: "1 change",
  at: "2026-10-28T10:00:00.000Z",
  from: A,
  to: B,
  commits: [{ id: B, subject: "Turn: write", at: "2026-10-28T10:00:00.000Z" }],
};
const same = { ok: true as const, kind: "markdown" as const, same: true, truncated: false, blocks: [], source: [] };
const changed = { ...same, same: false, blocks: [{ type: "paragraph" as const, status: "added" as const, after: "New." }] };

function setup() {
  const client = new FakeClient();
  client.timelines[DOC] = [entry];
  client.diffs[`${DOC}|${A}|${B}`] = changed;
  client.diffs[`${DOC}|${B}|current`] = same;
  return client;
}

describe("EntryDiff (file-timeline spec §4.1, §5, §6.1)", () => {
  it("compares here by default, or against the current version", async () => {
    const client = setup();
    await renderIn("en", <EntryDiff client={client} path={DOC} entry={entry} onBack={() => undefined} />);
    expect(await screen.findByText("New.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Against the current version" }));
    expect(await screen.findByText("No changes")).toBeTruthy();
    expect(client.fileCalls.filter((c) => c.op === "diff").map((c) => c.args)).toEqual([
      [DOC, A, B],
      [DOC, B, "current"],
    ]);
  });

  it("against the current version asks again after a commit to the file, or when the reader's text changes", async () => {
    const client = setup();
    const view = await renderIn("en", <EntryDiff client={client} path={DOC} entry={entry} onBack={() => undefined} refresh="one" />);
    await screen.findByText("New.");
    const diffs = () => client.fileCalls.filter((c) => c.op === "diff" && c.args[2] === "current").length;
    fireEvent.click(screen.getByRole("button", { name: "Against the current version" }));
    await screen.findByText("No changes");
    expect(diffs()).toBe(1);
    client.diffs[`${DOC}|${B}|current`] = changed;
    act(() => client.emitFileCommit([DOC]));
    expect(await screen.findByText("New.")).toBeTruthy();
    expect(diffs()).toBe(2);
    view.rerender(
      <I18nextProvider i18n={view.i18n}>
        <EntryDiff client={client} path={DOC} entry={entry} onBack={() => undefined} refresh="two" />
      </I18nextProvider>,
    );
    await waitFor(() => expect(diffs()).toBe(3));
    // A commit to another file asks nothing.
    act(() => client.emitFileCommit(["other.md"]));
    expect(diffs()).toBe(3);
  });

  it("go back: main's native confirmation, then the restore; a cancel is quiet and keeps everything", async () => {
    const client = setup();
    client.confirmGoBack = async () => false;
    let restored = 0;
    await renderIn("en", <EntryDiff client={client} path={DOC} entry={entry} onBack={() => undefined} onRestored={() => restored++} />);
    const button = await screen.findByRole("button", { name: "Go back to this version" });
    fireEvent.click(button);
    // Main asked (with the entry's author, time and kind); nothing is drawn in the window.
    await waitFor(() => expect(client.goBackAsks).toEqual([{ path: DOC, author: entry.author, at: entry.at, kind: "task" }]));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    expect(restored).toBe(0);
    expect(screen.getByRole("status", { hidden: true }).textContent).toBe("");
    client.confirmGoBack = async () => true;
    fireEvent.click(button);
    expect(await screen.findByText(`${DOC} is back to that version.`)).toBeTruthy();
    expect(restored).toBe(1);
  });

  it("disabled while a turn runs, and for a deleted entry; refusals are shown", async () => {
    const client = setup();
    await renderIn("en", <EntryDiff client={client} path={DOC} entry={entry} busy onBack={() => undefined} />);
    expect((await screen.findByRole("button", { name: "Go back to this version" })).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("The AI is working. You can go back when it finishes.")).toBeTruthy();
    cleanup();
    client.restoreAnswer = { ok: false, reason: "unsafe" };
    await renderIn("en", <EntryDiff client={client} path={DOC} entry={entry} onBack={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Go back to this version" }));
    expect(await screen.findByText("I couldn't write the file safely, so nothing changed.")).toBeTruthy();
    cleanup();
    await renderIn("en", <EntryDiff client={client} path={DOC} entry={{ ...entry, deleted: true }} onBack={() => undefined} />);
    expect((await screen.findByRole("button", { name: "Go back to this version" })).hasAttribute("disabled")).toBe(true);
  });
});

describe("Focus after the confirmation (file-timeline spec §5)", () => {
  it("returns to Go back after a cancel and after a restore; the status line is always there", async () => {
    const client = setup();
    let answer: (yes: boolean) => void = () => undefined;
    client.confirmGoBack = () => new Promise<boolean>((resolve) => (answer = resolve));
    await renderIn("en", <EntryDiff client={client} path={DOC} entry={entry} onBack={() => undefined} />);
    const button = await screen.findByRole("button", { name: "Go back to this version" });
    const status = screen.getByRole("status", { hidden: true });
    expect(status.textContent).toBe("");
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(client.goBackAsks).toHaveLength(1));
    act(() => answer(false));
    await waitFor(() => expect(document.activeElement).toBe(button));
    fireEvent.click(button);
    await waitFor(() => expect(client.goBackAsks).toHaveLength(2));
    act(() => answer(true));
    await waitFor(() => expect(status.textContent).toBe(`${DOC} is back to that version.`));
    await waitFor(() => expect(document.activeElement).toBe(button));
  });
});

describe("ChatView draws no go-back confirmation (main asks natively)", () => {
  it("a restore from anywhere in the window shows no dialog; main's answer comes back as is", async () => {
    const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
    client.timelines[DOC] = [entry];
    await renderIn("en", <ChatView client={client} state={client.state} components={{}} stateBlocks={[]} />);
    let result: Promise<unknown> = Promise.resolve();
    act(() => {
      result = client.files.restore(DOC, B);
    });
    expect(await result).toBe("restored");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    client.confirmGoBack = async () => false;
    expect(await client.files.restore(DOC, B)).toBe("cancelled");
  });
});
