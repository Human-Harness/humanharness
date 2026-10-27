// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidekickTab } from "../src/sidekick/SidekickTab";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";
import { SK_ON } from "./sidekick-fixtures";

afterEach(cleanup);

describe("Settings › Sidekick (spec §8)", () => {
  it("shows on/off, pre-send with the longest wait, the tier, the cap and the week", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickState = SK_ON;
    await renderIn("en", <SidekickTab client={c} onModels={() => {}} />);
    expect(await screen.findByRole("checkbox", { name: "Sidekick" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Before you send" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Longest wait" })).toBeTruthy();
    expect(screen.getByText("Light")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Cap per task" })).toBeTruthy();
    expect(screen.getByText("This week: 3,400 tokens")).toBeTruthy();
  });

  it("saves each change", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickState = SK_ON;
    await renderIn("en", <SidekickTab client={c} onModels={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "10 s" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["set", { wait: 10 }]));
    fireEvent.click(screen.getByRole("button", { name: "No cap" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["set", { cap: "none" }]));
    fireEvent.click(screen.getByRole("checkbox", { name: "Before you send" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["set", { preSend: false }]));
    fireEvent.click(screen.getByRole("checkbox", { name: "Sidekick" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["set", { on: false }]));
  });

  it("shows why a save failed", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickState = SK_ON;
    c.sidekick.set = async () => ({ ok: false, message: "disk full" });
    await renderIn("en", <SidekickTab client={c} onModels={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "10 s" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not save: disk full");
  });

  it("Change in Models opens the Models tab", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickState = SK_ON;
    const onModels = vi.fn();
    await renderIn("en", <SidekickTab client={c} onModels={onModels} />);
    fireEvent.click(await screen.findByRole("button", { name: "Change in Models" }));
    expect(onModels).toHaveBeenCalled();
  });
});

describe("Settings › Sidekick, learning (spec §6.3, §8)", () => {
  it("N of M used, and muted kinds with Undo", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickState = { ...SK_ON, used: { used: 3, of: 8 }, settings: { ...SK_ON.settings, muted: { sidekick: ["vague"] } } };
    await renderIn("en", <SidekickTab client={c} onModels={() => {}} />);
    expect(await screen.findByText("3 of 8 suggestions used this week")).toBeTruthy();
    expect(screen.getByText("Not flagged")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Flag “vague” again" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["unmute", "sidekick", "vague"]));
  });

  it("no share without cards, no Not flagged list without mutes", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickState = SK_ON;
    await renderIn("en", <SidekickTab client={c} onModels={() => {}} />);
    await screen.findByRole("checkbox", { name: "Sidekick" });
    expect(screen.queryByText(/suggestions used this week/)).toBeNull();
    expect(screen.queryByText("Not flagged")).toBeNull();
  });
});
