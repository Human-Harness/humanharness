// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { SEARCHABLE_SETTINGS } from "@humanharness/protocol";
import type { AppConfig, AppState } from "@humanharness/ui";
import { ModelsTab } from "../../../ui/src/ModelsTab";
import { type SettingsTab, SettingsPage } from "../../../ui/src/SettingsPage";
import { FakeClient } from "../../../ui/test/fake-client";
import { SK_ON } from "./sidekick-fixtures";
import { renderIn } from "./sidekick-app";

// Sidekick's cases of the core's Settings tests (settings, models-tab, usage-tab, search-settings-registry), moved
// with its tab, its Models row and its Usage line into the mod: the core mods run as the shell's renderer runs them.

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };

describe("Settings › Sidekick (from settings.test)", () => {
  function Sheet({ client, initialTab = "general" }: { client: FakeClient; initialTab?: SettingsTab }) {
    const [state, setState] = useState<AppState>(client.state);
    const [tab, setTab] = useState<SettingsTab>(initialTab);
    return <SettingsPage client={client} state={state} tab={tab} onTab={setTab} onChange={setState} onClose={() => {}} onSetup={() => {}} />;
  }

  it("adds the Sidekick tab after Models only with state.sidekick (D0 without)", async () => {
    const client = new FakeClient(ready);
    client.state.models = {
      recommended: { questions: "standard", sidekick: "light" },
      defaults: { claude: { light: { model: "haiku", effort: "low", cap: 100_000 }, standard: { model: "sonnet", effort: "medium", cap: 200_000 }, deep: { model: "opus", effort: "high", cap: 400_000 } } },
      offered: { claude: { models: [{ id: "haiku" }, { id: "sonnet" }, { id: "opus" }], efforts: ["low", "medium", "high", "xhigh", "max"] } },
      pinnedTokens: 3000,
    };
    const first = await renderIn("en", <Sheet client={client} />, { theme: true });
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["General", "Engine", "Models", "Mods", "Usage"]);
    first.unmount();
    client.state.sidekick = { id: "sidekick", name: "Sidekick", mark: "coach" };
    client.sidekickState = { ...SK_ON, settings: { ...SK_ON.settings, on: false }, status: "off" };
    await renderIn("en", <Sheet client={client} />, { theme: true });
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["General", "Engine", "Models", "Sidekick", "Mods", "Usage"]);
    fireEvent.click(screen.getByRole("tab", { name: "Sidekick" }));
    expect(await screen.findByRole("switch", { name: "Sidekick" })).toBeTruthy();
    // Change in Models switches the sheet's tab.
    fireEvent.click(screen.getByRole("button", { name: "Change in Models" }));
    expect(screen.getByRole("tab", { name: "Models" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("Sidekick row (sidekick spec §5, from models-tab.test)", () => {
  function modelsClient(models?: AppConfig["models"]) {
    const c = new FakeClient({ ...ready, ...(models ? { models } : {}) });
    c.state.actions = {
      manifest: { label: "The manifest", cost: "medium", tier: "standard" },
      turn: { label: "A turn", cost: "medium", tier: "deep" },
    };
    c.state.path = ["manifest", "turn"];
    c.state.engines.push({ ...c.state.engines[0], id: "codex", name: "Codex", reportsLimits: false });
    c.state.models = {
      recommended: { manifest: "standard", turn: "deep", questions: "light" },
      defaults: {
        claude: { light: { model: "haiku", effort: "low", cap: 100_000 }, standard: { model: "sonnet", effort: "medium", cap: 200_000 }, deep: { model: "opus", effort: "high", cap: 400_000 } },
        codex: { light: { effort: "low", cap: 100_000 }, standard: { effort: "medium", cap: 200_000 }, deep: { effort: "high", cap: 400_000 } },
      },
      offered: {
        claude: { models: [{ id: "haiku" }, { id: "sonnet" }, { id: "opus" }], efforts: ["low", "medium", "high", "xhigh", "max"] },
        codex: { models: [], efforts: ["low", "medium", "high"] },
      },
      pinnedTokens: 3000,
    };
    return c;
  }
  function Tab({ client }: { client: FakeClient }) {
    const [state, setState] = useState<AppState>(client.state);
    return <ModelsTab client={client} state={state} onChange={setState} />;
  }
  const tasksRegion = () => screen.getByRole("region", { name: "Tasks" });

  it("is listed in Tasks only while main sends Sidekick (D0)", async () => {
    const c = modelsClient();
    const first = await renderIn("en", <Tab client={c} />, { theme: true });
    expect(within(tasksRegion()).queryByRole("group", { name: "Sidekick" })).toBeNull();
    first.unmount();
    c.state.sidekick = { id: "sidekick", name: "Sidekick", mark: "coach" };
    await renderIn("en", <Tab client={c} />, { theme: true });
    expect(within(tasksRegion()).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["The manifest", "A turn", "Free question", "Sidekick"]);
    expect(screen.getByText("Reviews your prompts before they go out")).toBeTruthy();
  });
});

describe("Sidekick's line (sidekick spec §8, from usage-tab.test)", () => {
  function Sheet({ client }: { client: FakeClient }) {
    const [state, setState] = useState<AppState>(client.state);
    return <SettingsPage client={client} state={state} tab="usage" onTab={() => {}} onChange={setState} onClose={() => {}} onSetup={() => {}} />;
  }
  function claude(): FakeClient {
    const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" });
    client.state.engines = [{ ...client.state.engines[0], plansUrl: "https://claude.com/pricing" }];
    client.state.actions = {
      research: { label: "Research", cost: "heavy" },
      tidy: { label: "Tidy up", cost: "medium" },
      note: { label: "Quick note", cost: "light" },
    };
    client.state.path = ["tidy", "research"];
    return client;
  }
  /** The value of a row in "Apart from your tasks", or null when that row is missing. */
  const apart = (name: string) => screen.queryByRole("group", { name })?.textContent?.slice(name.length) ?? null;

  it("shows Sidekick's tokens once it has run, and nothing without (D0)", async () => {
    const client = claude();
    client.usage = { limits: [], estimates: {}, tokens: {}, primary: "five_hour", sidekick: 2440 };
    const first = await renderIn("en", <Sheet client={client} />);
    await waitFor(() => expect(apart("Sidekick")).toBe("about 2,440 tokens"));
    first.unmount();
    client.usage = { limits: [], estimates: {}, tokens: {}, primary: "five_hour" };
    await renderIn("en", <Sheet client={client} />);
    await screen.findByRole("tab", { name: "Usage" });
    expect(apart("Sidekick")).toBeNull();
  });

  it("shows beside the background jobs' line (from its case)", async () => {
    const client = claude();
    client.usage = { limits: [], estimates: {}, tokens: { questions: 1100 }, primary: "five_hour", sidekick: 2440, jobs: 4880 };
    await renderIn("en", <Sheet client={client} />);
    await waitFor(() => expect(apart("Background jobs")).toBe("about 4,880 tokens"));
    expect(apart("Sidekick")).toBe("about 2,440 tokens");
  });
});

describe("the Settings registry (search spec §6, from search-settings-registry.test)", () => {
  const shown = () => [...document.querySelectorAll<HTMLElement>("[data-setting]")].map((el) => el.dataset.setting);

  it("Sidekick renders exactly its registry rows", async () => {
    const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
    client.state.sidekick = { id: "sidekick", name: "Sidekick", mark: "coach" };
    client.sidekickState = SK_ON;
    await renderIn("en", <SettingsPage client={client} state={client.state} tab="sidekick" onTab={() => {}} onChange={() => {}} onClose={() => {}} onSetup={() => {}} />, { theme: true });
    await waitFor(() => expect(shown()).toContain("sidekick.on"));
    expect(shown().sort()).toEqual(SEARCHABLE_SETTINGS.filter((s) => s.tab === "sidekick").map((s) => s.id).sort());
  });
});
