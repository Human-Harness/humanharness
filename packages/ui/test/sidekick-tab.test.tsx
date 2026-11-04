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
    await renderIn("en", <SidekickTab client={c} onModels={() => {}} />, { theme: true });
    expect(await screen.findByRole("switch", { name: "Sidekick" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Before you send" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Longest wait" })).toBeTruthy();
    expect(screen.getByText("Light")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Cap per task" })).toBeTruthy();
    expect(screen.getByText("This week: 3,400 tokens")).toBeTruthy();
  });

  it("saves each change", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickState = SK_ON;
    await renderIn("en", <SidekickTab client={c} onModels={() => {}} />, { theme: true });
    fireEvent.click(await screen.findByRole("radio", { name: "10 s" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["set", { wait: 10 }]));
    fireEvent.click(screen.getByRole("radio", { name: "No cap" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["set", { cap: "none" }]));
    fireEvent.click(screen.getByRole("switch", { name: "Before you send" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["set", { preSend: false }]));
    fireEvent.click(screen.getByRole("switch", { name: "Sidekick" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["set", { on: false }]));
  });

  it("each moment on its own (spec §8)", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickState = SK_ON;
    await renderIn("en", <SidekickTab client={c} onModels={() => {}} />, { theme: true });
    fireEvent.click(await screen.findByRole("switch", { name: "After the reply" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["set", { afterReply: false }]));
    fireEvent.click(screen.getByRole("switch", { name: "Heads-ups" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["set", { headsUps: false }]));
  });

  it("shows why a save failed", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickState = SK_ON;
    c.sidekick.set = async () => ({ ok: false, message: "disk full" });
    await renderIn("en", <SidekickTab client={c} onModels={() => {}} />, { theme: true });
    fireEvent.click(await screen.findByRole("radio", { name: "10 s" }));
    expect((await screen.findByRole("alert")).textContent?.trim()).toBe("Could not save: disk full");
  });

  it("Change in Models opens the Models tab", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickState = SK_ON;
    const onModels = vi.fn();
    await renderIn("en", <SidekickTab client={c} onModels={onModels} />, { theme: true });
    fireEvent.click(await screen.findByRole("button", { name: "Change in Models" }));
    expect(onModels).toHaveBeenCalled();
  });
});

describe("Settings › Sidekick, look (UI refresh)", () => {
  it("puts the main switch in the head and three stats on top", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickState = SK_ON;
    await renderIn("en", <SidekickTab client={c} onModels={() => {}} />, { theme: true });
    const main = await screen.findByRole("switch", { name: "Sidekick" });
    // The head is the section's line with the switch beside it; the stats come right after it, a card each.
    expect(screen.getByText(/^Reads your prompt/).parentElement?.contains(main)).toBe(true);
    const stats = document.querySelector('[data-setting="sidekick.tier"]')!.parentElement!;
    expect(stats.querySelectorAll(".rt-Card")).toHaveLength(3);
    for (const label of ["This week", "Suggestions used", "Model"]) expect(stats.contains(screen.getByText(label))).toBe(true);
  });
});

describe("Settings › Sidekick, learning (spec §6.3, §8)", () => {
  it("N of M used, and muted kinds with Undo", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickState = { ...SK_ON, used: { used: 3, of: 8 }, settings: { ...SK_ON.settings, muted: { sidekick: ["vague"] } } };
    await renderIn("en", <SidekickTab client={c} onModels={() => {}} />, { theme: true });
    expect(await screen.findByText("3 of 8 suggestions used this week")).toBeTruthy();
    expect(screen.getByText("Not flagged")).toBeTruthy();
    expect(screen.getByText("Sidekick · Vague words")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Flag “Vague words” again" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["unmute", "sidekick", "vague"]));
  });

  it("no share without cards, no Not flagged list without mutes", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickState = SK_ON;
    await renderIn("en", <SidekickTab client={c} onModels={() => {}} />, { theme: true });
    await screen.findByRole("switch", { name: "Sidekick" });
    expect(screen.queryByText(/suggestions used this week/)).toBeNull();
    expect(screen.queryByText("Not flagged")).toBeNull();
  });
});
