// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessApp } from "../../../ui/src";
import { resetWorkDetail } from "../../../ui/src/ActivityList";
import { FakeClient } from "../../../ui/test/fake-client";
import { render } from "./home-block";
import { railHistory } from "./one-bar";

afterEach(() => {
  cleanup();
  resetWorkDetail();
});

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };

describe("the working line on the task's pages (task view one column)", () => {
  it("History keeps the line at its bottom while the turn runs; Stop ends it; it goes with the turn", async () => {
    const client = new FakeClient(ready);
    render(<HarnessApp client={client} />);
    const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);
    const box = await screen.findByPlaceholderText("Write a message…");
    fireEvent.change(box, { target: { value: "go" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(client.sent).toEqual(["go"]));
    act(() => client.emit({ type: "activity", id: "a", kind: "read", detail: "notes.md", state: "start" }));
    await railHistory(client);
    await screen.findByRole("heading", { name: "History" });
    const lines = document.querySelectorAll(".hh-working-line");
    // One line on screen: the page's (the chat's own is hidden under the page).
    const shown = [...lines].filter((l) => !l.closest(".hh-app-paged, [hidden]"));
    expect(shown).toHaveLength(1);
    expect(shown[0].textContent).toContain("Working · Reading notes.md");
    fireEvent.click(shown[0].querySelector("button")!);
    await waitFor(() => expect(client.cancelled).toBe(1));
    act(() => client.emit({ type: "done", ok: true }));
    expect(document.querySelectorAll(".hh-working-line")).toHaveLength(0);
  });
});
