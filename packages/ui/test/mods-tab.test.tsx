// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModsView } from "../src/client";
import { ModsTab } from "../src/mods/ModsTab";
import { visibleTabs } from "../src/settings-tabs";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const view: ModsView = {
  mods: [
    { id: "echo", name: "Echo", version: "0.1.0", origin: "harness", on: true, ui: false, registers: { hooks: ["beforeSend"], ipc: [] } },
    { id: "mine", name: "Mine", version: "0.1.0", origin: "local", on: false, ui: false, failed: "boom", registers: { hooks: [], ipc: [] } },
  ],
  problems: [],
};

function client(over: Partial<FakeClient["mods"]> = {}): FakeClient {
  const c = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" });
  c.mods = { ...c.mods, view: vi.fn(async () => view), ...over };
  return c;
}

describe("Settings › Mods", () => {
  it("lists mods with their switch, the local badge, the failure line and what they use", async () => {
    await renderIn("en", <ModsTab client={client()} />, { theme: true });
    expect((await screen.findByRole("switch", { name: "Echo" })).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("switch", { name: "Mine" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Local")).toBeTruthy();
    expect(screen.queryByText("Harness")).toBeNull();
    expect(screen.getByText("Turned off after failing three times: boom")).toBeTruthy();
    expect(screen.getByText("Uses: beforeSend")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
  });

  it("a switch turns the mod on or off and shows main's answer", async () => {
    const set = vi.fn(async (_id: string, on: boolean): Promise<ModsView> => ({ ...view, mods: view.mods.map((m) => (m.id === "echo" ? { ...m, on } : m)) }));
    await renderIn("en", <ModsTab client={client({ set })} />, { theme: true });
    fireEvent.click(await screen.findByRole("switch", { name: "Echo" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Echo" }).getAttribute("aria-checked")).toBe("false"));
    expect(set).toHaveBeenCalledWith("echo", false);
  });

  it("Remove removes only that local mod", async () => {
    const removeLocal = vi.fn(async (): Promise<ModsView> => ({ ...view, mods: view.mods.filter((m) => m.id !== "mine") }));
    await renderIn("en", <ModsTab client={client({ removeLocal })} />, { theme: true });
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByRole("switch", { name: "Mine" })).toBeNull());
    expect(removeLocal).toHaveBeenCalledWith("mine");
  });

  it("Add from folder shows the warning and turns on only after Turn on", async () => {
    const addLocal = vi.fn(async () => view);
    const reviewLocal = vi.fn(async () => ({ review: { id: "x", name: "X", version: "1.0.0", folder: "/m/x" }, token: "a".repeat(32) }));
    const onSub = vi.fn();
    await renderIn("en", <ModsTab client={client({ reviewLocal, addLocal })} onSub={onSub} />, { theme: true });
    fireEvent.click(await screen.findByRole("button", { name: "Add from folder…" }));
    expect(await screen.findByText(/full access to your folder/)).toBeTruthy();
    expect(screen.getByText("From /m/x")).toBeTruthy();
    expect(onSub).toHaveBeenLastCalledWith(expect.objectContaining({ label: "Mods" }));
    expect(addLocal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(addLocal).toHaveBeenCalledWith("a".repeat(32)));
    expect(await screen.findByRole("switch", { name: "Echo" })).toBeTruthy();
  });

  it("a home-folder mod main refuses to turn on shows the warning first, then turns on through its token", async () => {
    const set = vi.fn(async (): Promise<ModsView> => {
      throw new Error("This mod needs your review first");
    });
    const reviewLocal = vi.fn(async () => ({ review: { id: "mine", name: "Mine", version: "0.1.0", folder: "/home/app/mods/mine" }, token: "b".repeat(32) }));
    const addLocal = vi.fn(async () => view);
    await renderIn("en", <ModsTab client={client({ set, reviewLocal, addLocal })} />, { theme: true });
    fireEvent.click(await screen.findByRole("switch", { name: "Mine" }));
    expect(await screen.findByText(/full access to your folder/)).toBeTruthy();
    expect(reviewLocal).toHaveBeenCalledWith("mine");
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(addLocal).toHaveBeenCalledWith("b".repeat(32)));
  });

  it("a refused switch with no review stays an error on the row", async () => {
    const set = vi.fn(async (): Promise<ModsView> => {
      throw new Error("nope");
    });
    const reviewLocal = vi.fn(async () => ({ problem: "No mod in the app's home folder has the id" }));
    await renderIn("en", <ModsTab client={client({ set, reviewLocal })} />, { theme: true });
    fireEvent.click(await screen.findByRole("switch", { name: "Mine" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/full access to your folder/)).toBeNull();
  });

  it("Cancel goes back to the list without adding", async () => {
    const addLocal = vi.fn(async () => view);
    const reviewLocal = vi.fn(async () => ({ review: { id: "x", name: "X", version: "1.0.0", folder: "/m/x" }, token: "a".repeat(32) }));
    await renderIn("en", <ModsTab client={client({ reviewLocal, addLocal })} />, { theme: true });
    fireEvent.click(await screen.findByRole("button", { name: "Add from folder…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("switch", { name: "Echo" })).toBeTruthy();
    expect(addLocal).not.toHaveBeenCalled();
  });

  it("a folder that isn't a mod says why under Add from folder", async () => {
    const reviewLocal = vi.fn(async () => ({ problem: "no mod.json" }));
    await renderIn("en", <ModsTab client={client({ reviewLocal })} />, { theme: true });
    fireEvent.click(await screen.findByRole("button", { name: "Add from folder…" }));
    expect(await screen.findByText("no mod.json")).toBeTruthy();
  });

  it("Mods is a tab right after Sidekick, always shown", () => {
    const c = new FakeClient({ language: "en" });
    const tabs = visibleTabs(c.state);
    expect(tabs).toContain("mods");
    const at = tabs.indexOf("mods");
    if (tabs.includes("plugins")) expect(tabs.indexOf("plugins")).toBe(at + 1);
  });
});
