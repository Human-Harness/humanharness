// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type BlockComponent, ModBlocksProvider, createBlockRegistry } from "@humanharness/ui";
import { HarnessApp } from "../../../ui/src";
import { FakeClient } from "../../../ui/test/fake-client";
import { historyViewRegistry } from "../../../ui/test/history-view";
import { usageRegistry } from "../../../ui/test/usage-mod";
import mod from "../src/ui";

afterEach(cleanup);

// The window with the context-panel mod off: Home and the other core mods are there, the `context-panel/panel` block is not.
const registry = createBlockRegistry();
mod.ui?.({ id: "home", block: (name, component) => registry.register("home", name, component as BlockComponent) });
historyViewRegistry(registry);
usageRegistry(registry);

describe("the task view with the context-panel mod off", () => {
  it("the chip has no Open context and no panel is drawn", async () => {
    const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" });
    client.state.actions = { manifest: { label: "The manifest", cost: "medium" } };
    client.state.path = ["manifest"];
    client.tasks = { current: { id: "t1", action: "manifest", status: "waiting", context: { used: 40_000, cap: 200_000 } }, actions: {}, notes: [] };
    render(<HarnessApp client={client} locales={{ en: {} }} />, { wrapper: ({ children }) => <ModBlocksProvider registry={registry}>{children}</ModBlocksProvider> });
    const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);
    fireEvent.click(await screen.findByRole("button", { name: /^Context \d+%$/ }));
    const pop = await screen.findByRole("dialog");
    expect(pop.textContent).toContain("In use now");
    expect(within(pop).queryByRole("button", { name: "Open context" })).toBeNull();
    expect(screen.queryByRole("region", { name: "What the AI takes into account" })).toBeNull();
  });
});
