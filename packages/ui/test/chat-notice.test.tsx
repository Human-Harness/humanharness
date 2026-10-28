// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessApp } from "../src";
import type { ChatEntry } from "../src/client";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };

/** Home's Start, once the engine check has passed. */
async function clickStart() {
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
}

/** A conflict notice as board mode saves it after a reply (parallel spec §5.3): no text of its own. */
const notice = (extra: Partial<NonNullable<ChatEntry["notice"]>> = {}): ChatEntry => ({
  id: "n",
  role: "assistant",
  text: "",
  blocks: [],
  activities: [],
  at: "t",
  task: "t1",
  notice: { kind: "conflict", paths: ["spec.md"], other: "Write", ...extra },
});

describe("a notice in a task's chat (parallel spec §5.3)", () => {
  it("draws as a system line, never as the agent's reply", async () => {
    const client = new FakeClient(ready);
    client.chat = [
      { id: "1", role: "user", text: "hi", blocks: [], activities: [], at: "t", task: "t1" },
      { id: "2", role: "assistant", text: "Done.", blocks: [], activities: [], at: "t", task: "t1" },
      notice(),
      notice({ paths: ["a.md", "b.md", "c.md", "d.md", "e.md"], more: 3, other: undefined, ended: true }),
    ];
    render(<HarnessApp client={client} />);
    await clickStart();
    const line = await screen.findByText("This task and “Write” both changed spec.md.");
    expect(line.className).toBe("hh-mode-line");
    expect(line.closest("article")?.className).toBe("hh-message system");
    expect(screen.getByText("A task that has ended also changed a.md, b.md, c.md, d.md, e.md and 3 more.")).toBeTruthy();
  });

  it("a notice that comes during the turn shows as the same system line after the answer, never as an activity", async () => {
    const client = new FakeClient(ready);
    render(<HarnessApp client={client} />);
    await clickStart();
    const box = await screen.findByRole("textbox");
    fireEvent.change(box, { target: { value: "both" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(client.sent).toEqual(["both"]));
    client.emit({ type: "text", delta: "Wrote spec." });
    client.emit({ type: "task-notice", notice: { kind: "conflict", paths: ["spec.md"], other: "Write" } });
    client.emit({ type: "task-notice", notice: { kind: "resume-failed" } });
    client.emit({ type: "done", ok: true });
    const line = await screen.findByText("This task and “Write” both changed spec.md.");
    expect(line.closest("article")?.className).toBe("hh-message system");
    expect(screen.getByText("Couldn't resume the earlier conversation; started a new one.").closest("article")?.className).toBe("hh-message system");
    expect(screen.queryByText(/Working on/)).toBeNull();
    // After the answer, in the order the saved chat has them.
    const order = [...document.querySelectorAll("article")].map((a) => a.textContent ?? "");
    const at = (text: string) => order.findIndex((t) => t.includes(text));
    expect(at("Wrote spec.")).toBeLessThan(at("both changed spec.md"));
  });

  it("a waiting task's choices stay answerable after a notice", async () => {
    const client = new FakeClient(ready);
    client.chat = [
      { id: "1", role: "user", text: "hi", blocks: [], activities: [], at: "t", task: "t1" },
      { id: "2", role: "assistant", text: "Pick one.", blocks: [{ name: "choices", data: { options: [{ label: "Tell me more" }] } }], activities: [], at: "t", task: "t1" },
      notice(),
    ];
    client.tasks = { current: { id: "t1", status: "waiting" }, actions: {}, notes: [] };
    render(<HarnessApp client={client} />);
    await clickStart();
    await screen.findByText("Pick one.");
    const more = screen.getByRole("button", { name: "Tell me more" }) as HTMLButtonElement;
    await waitFor(() => expect(more.disabled).toBe(false));
    fireEvent.click(more);
    await waitFor(() => expect(client.chosenTasks).toEqual(["t1"]));
  });

  it("a failed turn keeps its error and Try again after a notice", async () => {
    const client = new FakeClient(ready);
    client.chat = [
      { id: "1", role: "user", text: "earlier question", blocks: [], activities: [], at: "t" },
      { id: "2", role: "assistant", text: "", blocks: [], activities: [], at: "t", error: { code: "agent-crashed" } },
      notice(),
    ];
    render(<HarnessApp client={client} />);
    await clickStart();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(client.sent).toEqual(["earlier question"]));
  });
});
