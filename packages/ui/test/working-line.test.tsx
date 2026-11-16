// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetWorkDetail } from "../src/ActivityList";
import { ChatView } from "../src/ChatView";
import { TaskBar } from "../src/task-view/TaskBar";
import { WorkingLine } from "../src/task-view/WorkingLine";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(() => {
  cleanup();
  resetWorkDetail();
});

describe("WorkingLine", () => {
  it("says Working · the step, and Stop ends the turn", async () => {
    const onStop = vi.fn();
    await renderIn("en", <WorkingLine step="Reading notes.md" onStop={onStop} />);
    expect(screen.getByRole("status").textContent).toBe("Working · Reading notes.md");
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("without a step yet, only Working", async () => {
    await renderIn("en", <WorkingLine step={null} onStop={() => {}} />);
    expect(screen.getByRole("status").textContent).toBe("Working");
  });
});

describe("the working line in the chat", () => {
  async function turn() {
    const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
    const onWorking = vi.fn();
    await renderIn("en", <ChatView client={client} state={client.state} components={{}} stateBlocks={[]} onWorking={onWorking} />);
    const box = await screen.findByRole("textbox");
    fireEvent.change(box, { target: { value: "go" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(client.sent).toEqual(["go"]));
    return { client, onWorking };
  }

  it("during a turn one status region says the step, with Stop; at the end it goes", async () => {
    const { client } = await turn();
    act(() => client.emit({ type: "activity", id: "a", kind: "read", detail: "notes.md", state: "start" }));
    const conversation = screen.getByRole("region", { name: "Conversation" });
    const statuses = within(conversation).getAllByRole("status");
    expect(statuses).toHaveLength(1);
    expect(statuses[0].textContent).toBe("Working · Reading notes.md");
    // It is the conversation card's last piece: pinned to its bottom.
    expect(conversation.lastElementChild?.classList.contains("hh-working-line")).toBe(true);
    // Nothing else on screen says "Working…".
    expect(screen.queryByText(/Working…/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(client.cancelled).toBe(1));
    act(() => client.emit({ type: "done", ok: true }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("tells the shell the step, and null at the end of the turn", async () => {
    const { client, onWorking } = await turn();
    act(() => client.emit({ type: "activity", id: "a", kind: "read", detail: "notes.md", state: "start" }));
    expect(onWorking).toHaveBeenLastCalledWith({ step: "Reading notes.md" });
    act(() => client.emit({ type: "done", ok: true }));
    expect(onWorking).toHaveBeenLastCalledWith(null);
  });
});

describe("the bar's status", () => {
  it("is still while the task waits: nothing animates", async () => {
    const { container } = await renderIn(
      "en",
      <TaskBar open harness="Demo" onHome={() => {}} switcher={<span>Task</span>} working={false} />,
    );
    const status = within(container).getByRole("status");
    expect(status.textContent).toBe("Waiting for you");
    expect(status.querySelector(".hh-icon-loading, [class*='spin'], [class*='pulse']")).toBeNull();
    expect(status.getAttribute("data-working")).toBe("false");
  });
});
