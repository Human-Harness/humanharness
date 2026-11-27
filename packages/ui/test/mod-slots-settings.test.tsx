// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TFunction } from "i18next";
import { createI18n } from "@humanharness/i18n";
import { type ModsView } from "../src/client";
import { type BlockRegistry, ModBlocksProvider, type RowProps, type SettingsAppProps, type SettingsTabProps, appRegistry, createBlockRegistry } from "../src/layout/registry";
import { type UiCtx, startModLoader } from "../src/layout/mod-loader";
import { ModelsTab } from "../src/ModelsTab";
import { commandRows } from "../../mods/search/src/local";
import { SettingsPage } from "../src/SettingsPage";
import { tabLabel, visibleTabs } from "../src/settings-tabs";
import { UsageTab } from "../../mods/usage/src/UsageTab";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

function client() {
  const c = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" });
  c.state.models = {
    recommended: { questions: "standard" },
    defaults: { claude: { light: { model: "haiku", effort: "low", cap: 100_000 }, standard: { model: "sonnet", effort: "medium", cap: 200_000 }, deep: { model: "opus", effort: "high", cap: 400_000 } } },
    offered: { claude: { models: [{ id: "haiku" }, { id: "sonnet" }, { id: "opus" }], efforts: ["low", "medium", "high"] } },
    pinnedTokens: 3000,
  };
  const set = vi.fn(async (_id: string, _on: boolean): Promise<ModsView> => ({ mods: [], problems: [] }));
  c.mods = { ...c.mods, set };
  return { c, set };
}

const wrap = (registry: BlockRegistry, ui: ReactNode) => <ModBlocksProvider registry={registry}>{ui}</ModBlocksProvider>;

/** Runs a test mod's `ui(ctx)` through the window's loader, into `registry`. */
async function load(registry: BlockRegistry, ui: (ctx: UiCtx) => void) {
  const mods = {
    view: async (): Promise<ModsView> => ({ mods: [], problems: [] }),
    onChanged: () => () => {},
    onReloaded: () => () => {},
    call: async () => undefined,
    on: () => () => {},
  };
  const loader = startModLoader({ client: { mods }, registry, core: [{ id: "test", ui }] });
  await loader.settled();
  return loader;
}

const Boom = (): ReactNode => {
  throw new Error("boom");
};

describe("a mod's Settings tab (ctx.settingsTab)", () => {
  it("shows right after Models, with its label, and renders the mod's component", async () => {
    const registry = createBlockRegistry();
    const Tab = ({ openTab }: SettingsTabProps) => (
      <button type="button" onClick={() => openTab("models")}>
        Mod tab body
      </button>
    );
    await load(registry, (ctx) => ctx.settingsTab("x", Tab, { label: "Extra" }));
    const { c } = client();
    const onTab = vi.fn();
    await renderIn("en", wrap(registry, <SettingsPage client={c} state={c.state} tab="x" onTab={onTab} onChange={() => {}} onClose={() => {}} onSetup={() => {}} />), { theme: true });
    const tabs = visibleTabs(c.state, registry);
    expect(tabs.indexOf("x")).toBe(tabs.indexOf("models") + 1);
    expect(screen.getAllByText("Extra").length).toBeGreaterThan(0);
    fireEvent.click(await screen.findByText("Mod tab body"));
    expect(onTab).toHaveBeenCalledWith("models");
  });

  it("search's settings list offers it (the app's registry)", async () => {
    const t: TFunction = (await createI18n("en")).t;
    const { c } = client();
    const off = appRegistry.add("settingsTab", { mod: "test", name: "x", label: "Extra", Component: () => null });
    try {
      expect(visibleTabs(c.state)).toContain("x");
      expect(tabLabel(t, c.state, "x")).toBe("Extra");
      expect(commandRows(t, c.state, "", null, [], null).map((r) => r.id)).toContain("command:open-settings:x");
    } finally {
      off();
    }
    expect(visibleTabs(c.state)).not.toContain("x");
  });

  it("a tab that throws shows the failed part with Turn off, and the rest of Settings stays", async () => {
    const registry = createBlockRegistry();
    registry.add("settingsTab", { mod: "test", name: "x", label: "Extra", Component: Boom });
    const { c, set } = client();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await renderIn("en", wrap(registry, <SettingsPage client={c} state={c.state} tab="x" onTab={() => {}} onChange={() => {}} onClose={() => {}} onSetup={() => {}} />), { theme: true });
    const alert = await screen.findByRole("alert");
    fireEvent.click(within(alert).getByRole("button", { name: "Turn off" }));
    expect(set).toHaveBeenCalledWith("test", false);
    expect(screen.getAllByText("Models").length).toBeGreaterThan(0);
  });

  it("shows only while its shown(state) holds, and gets the client and the state", async () => {
    const registry = createBlockRegistry();
    const seen: SettingsAppProps[] = [];
    const Tab = ({ client: given, state }: SettingsTabProps) => {
      seen.splice(0, seen.length, { client: given, state });
      return <p>Mod tab body</p>;
    };
    await load(registry, (ctx) => ctx.settingsTab("x", Tab, { label: "Extra", shown: (state) => state.engines.length > 0 }));
    const { c } = client();
    expect(visibleTabs(c.state, registry)).toContain("x");
    expect(visibleTabs({ ...c.state, engines: [] }, registry)).not.toContain("x");
    await renderIn("en", wrap(registry, <SettingsPage client={c} state={c.state} tab="x" onTab={() => {}} onChange={() => {}} onClose={() => {}} onSetup={() => {}} />), { theme: true });
    await screen.findByText("Mod tab body");
    expect(seen[0]?.client).toBe(c);
    expect(seen[0]?.state).toBe(c.state);
  });

  it("its label may change: the nav reads what useLabel returns", async () => {
    const registry = createBlockRegistry();
    const useLabel = ({ state }: SettingsAppProps) => (state.engines.length > 0 ? "Extras" : "Extra");
    await load(registry, (ctx) => ctx.settingsTab("x", () => null, { label: "Extra", useLabel }));
    const { c } = client();
    await renderIn("en", wrap(registry, <SettingsPage client={c} state={c.state} tab="general" onTab={() => {}} onChange={() => {}} onClose={() => {}} onSetup={() => {}} />), { theme: true });
    expect(await screen.findByRole("tab", { name: "Extras" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Extra" })).toBeNull();
  });

  it("taken away, the tab goes", async () => {
    const registry = createBlockRegistry();
    const loader = await load(registry, (ctx) => ctx.settingsTab("x", () => null, { label: "Extra" }));
    const { c } = client();
    expect(visibleTabs(c.state, registry)).toContain("x");
    loader.stop();
    expect(visibleTabs(c.state, registry)).not.toContain("x");
  });
});

describe("a mod's rows (ctx.row)", () => {
  it("Models: the row goes after the core's task rows, and may draw a task row the core's way", async () => {
    const registry = createBlockRegistry();
    const Row = ({ taskRow }: RowProps) => <>{taskRow?.({ key: "helper", label: "Helper reviews", description: "Its own reviews" })}</>;
    await load(registry, (ctx) => ctx.row("models", Row));
    const { c } = client();
    await renderIn("en", wrap(registry, <ModelsTab client={c} state={c.state} onChange={() => {}} />), { theme: true });
    const rows = await screen.findAllByRole("group");
    const labels = rows.map((r) => r.getAttribute("aria-label"));
    expect(labels.indexOf("Helper reviews")).toBeGreaterThan(labels.indexOf("Questions"));
  });

  it("Usage: the line goes after the core's lines; a throwing row shows the failed part", async () => {
    const registry = createBlockRegistry();
    await load(registry, (ctx) => {
      ctx.row("usage", () => <p>Mod tokens: 12</p>);
      ctx.row("usage", Boom);
    });
    const { c } = client();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await renderIn("en", wrap(registry, <UsageTab client={c} state={c.state} />), { theme: true });
    expect(await screen.findByText("Mod tokens: 12")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("a row shows only while its shown(props) holds, and gets the client, the state and Usage's summary", async () => {
    const registry = createBlockRegistry();
    const seen: RowProps[] = [];
    const Line = (p: RowProps) => {
      seen.splice(0, seen.length, p);
      return <p>Mod line</p>;
    };
    await load(registry, (ctx) => {
      ctx.row("usage", Line, { shown: ({ usage }) => usage?.jobs !== undefined });
      ctx.row("models", () => <p>Hidden row</p>, { shown: () => false });
    });
    const { c } = client();
    c.usage = { limits: [], estimates: {}, tokens: {}, primary: "five_hour", jobs: 10 };
    const first = await renderIn("en", wrap(registry, <UsageTab client={c} state={c.state} />), { theme: true });
    await screen.findByText("Mod line");
    expect(seen[0]?.client).toBe(c);
    expect(seen[0]?.state).toBe(c.state);
    expect(seen[0]?.usage?.jobs).toBe(10);
    first.unmount();
    c.usage = { limits: [], estimates: {}, tokens: {}, primary: "five_hour" };
    await renderIn("en", wrap(registry, <UsageTab client={c} state={c.state} />), { theme: true });
    await screen.findByRole("tab", { name: "Usage" }).catch(() => undefined);
    expect(screen.queryByText("Mod line")).toBeNull();
    cleanup();
    await renderIn("en", wrap(registry, <ModelsTab client={c} state={c.state} onChange={() => {}} />), { theme: true });
    await screen.findAllByRole("group");
    expect(screen.queryByText("Hidden row")).toBeNull();
  });

  it("with nothing registered, Models and Usage draw no mod part", async () => {
    const { c } = client();
    await renderIn("en", <UsageTab client={c} state={c.state} />, { theme: true });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
