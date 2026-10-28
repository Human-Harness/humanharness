// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatView } from "../src/ChatView";
import type { FileRestorePrompt, HarnessClient, TimelineEntry } from "../src/client";
import { EntryDiff } from "../src/EntryDiff";
import { RestoreConfirm } from "../src/RestoreConfirm";
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

  it("go back: the core's confirmation, then the restore; cancel keeps everything", async () => {
    const client = setup();
    let restored = 0;
    await renderIn(
      "en",
      <>
        <RestoreHost client={client} />
        <EntryDiff client={client} path={DOC} entry={entry} onBack={() => undefined} onRestored={() => restored++} />
      </>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Go back to this version" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(`Go back ${DOC} to how it was after Spec writer`);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(restored).toBe(0);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const again = screen.getByRole("button", { name: "Go back to this version" });
    // The cancelled restore settles, then the button is enabled again.
    await waitFor(() => expect(again.hasAttribute("disabled")).toBe(false));
    fireEvent.click(again);
    fireEvent.click(await screen.findByRole("button", { name: "Yes, go back" }));
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
    client.files.hostConfirm(async () => true);
    await renderIn("en", <EntryDiff client={client} path={DOC} entry={entry} onBack={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Go back to this version" }));
    expect(await screen.findByText("I couldn't write the file safely, so nothing changed.")).toBeTruthy();
    cleanup();
    await renderIn("en", <EntryDiff client={client} path={DOC} entry={{ ...entry, deleted: true }} onBack={() => undefined} />);
    expect((await screen.findByRole("button", { name: "Go back to this version" })).hasAttribute("disabled")).toBe(true);
  });
});

describe("RestoreConfirm (file-timeline spec §5)", () => {
  it("names an approval by its version; Cancel has focus; Esc answers no", async () => {
    const answers: boolean[] = [];
    const prompt: FileRestorePrompt = { path: DOC, author: { kind: "person", label: "You" }, at: entry.at, kind: "approval", version: 2 };
    await renderIn("en", <RestoreConfirm prompt={prompt} onAnswer={(yes) => answers.push(yes)} />);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain(`Go back ${DOC} to how it was after v2 approved`);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(answers).toEqual([false]);
  });
});

describe("ChatView hosts the confirmation (file-timeline spec §5, Q4)", () => {
  async function chat() {
    const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
    client.timelines[DOC] = [entry];
    const view = await renderIn("en", <ChatView client={client} state={client.state} components={{}} stateBlocks={[]} />);
    return { client, view };
  }

  it("draws nothing until a restore asks; a yes restores", async () => {
    const { client } = await chat();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    let result: Promise<unknown> = Promise.resolve();
    act(() => {
      result = client.files.restore(DOC, B);
    });
    expect((await screen.findByRole("alertdialog")).textContent).toContain(`Go back ${DOC}`);
    fireEvent.click(screen.getByRole("button", { name: "Yes, go back" }));
    expect(await result).toBe("restored");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("a second request answers the first no; closing the chat answers no and unregisters", async () => {
    const { client, view } = await chat();
    let first: Promise<unknown> = Promise.resolve();
    let second: Promise<unknown> = Promise.resolve();
    act(() => {
      first = client.files.restore(DOC, B);
    });
    await screen.findByRole("alertdialog");
    act(() => {
      second = client.files.restore(DOC, B);
    });
    expect(await first).toBe("cancelled");
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    view.unmount();
    expect(await second).toBe("cancelled");
    expect(await client.files.restore(DOC, B)).toBe("cancelled");
  });
});

/** What ChatView does: registers the confirmation with the client and draws it. */
function RestoreHost({ client }: { client: HarnessClient }) {
  const [ask, setAsk] = useState<{ prompt: FileRestorePrompt; answer: (yes: boolean) => void } | null>(null);
  useEffect(() => client.files.hostConfirm((prompt) => new Promise<boolean>((answer) => setAsk({ prompt, answer }))), [client]);
  return ask ? <RestoreConfirm prompt={ask.prompt} onAnswer={(yes) => (ask.answer(yes), setAsk(null))} /> : null;
}
