// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessApp } from "../src";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };

describe("the conversation and the composer in the soft-cards look (UI refresh spec §5.1)", () => {
  it("the messages sit in one conversation card; the composer has ⏎ to send and the amber Send", async () => {
    render(<HarnessApp client={new FakeClient(ready)} locales={{ en: {} }} />);
    const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);
    const conversation = await screen.findByRole("region", { name: "Conversation" });
    expect(conversation.className).toContain("hh-card");
    const form = (await screen.findByRole("button", { name: "Send" })).closest("form")!;
    expect(within(form).getByRole("button", { name: "Send" }).className).toContain("hh-cta");
    expect(within(form).getByText("⏎ to send")).toBeTruthy();
  });
});
