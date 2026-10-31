// @vitest-environment happy-dom
import fs from "node:fs";
import path from "node:path";
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SEARCHABLE_SETTINGS } from "@humanharness/protocol";
import type { AppState, ModelsView, SearchSettingsTab } from "../src/client";
import { SettingsPage } from "../src/SettingsPage";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";
import { SK_ON } from "./sidekick-fixtures";

afterEach(cleanup);

const SRC = path.resolve(__dirname, "../src");
const en: unknown = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../i18n/src/locales/en.json"), "utf8"));
const sources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
const text = sources(SRC).map((f) => fs.readFileSync(f, "utf8")).join("\n");
const keyOf = (k: string): unknown => k.split(".").reduce<unknown>((o, p) => (o && typeof o === "object" ? (o as Record<string, unknown>)[p] : undefined), en);
const shown = () => [...document.querySelectorAll<HTMLElement>("[data-setting]")].map((el) => el.dataset.setting);

describe("the Settings registry (search spec §6, plan deviation 13)", () => {
  it("every entry has a row in ui/src, every row an entry, every label a string in en.json", () => {
    const written = new Set([...text.matchAll(/data-setting="([^"]+)"/g)].map((m) => m[1]));
    const ids = new Set(SEARCHABLE_SETTINGS.map((s) => s.id));
    expect([...ids].filter((id) => !written.has(id))).toEqual([]);
    expect([...written].filter((id) => !ids.has(id))).toEqual([]);
    expect(SEARCHABLE_SETTINGS.filter((s) => typeof keyOf(s.label) !== "string").map((s) => s.id)).toEqual([]);
  });

  it("General renders its rows for the state given (folder set, no parallel, no profiles)", async () => {
    const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" });
    const state = client.state;
    await renderIn("en", <SettingsPage client={client} state={state} tab="general" onTab={() => {}} onChange={() => {}} onClose={() => {}} onSetup={() => {}} />);
    await waitFor(() => expect(shown()).toContain("general.appearance"));
    expect(shown().sort()).toEqual(["general.appearance", "general.folder", "general.language", "general.textSize", ...(state.backup?.status ? ["general.backup"] : [])].sort());
  });

  it("Sidekick renders exactly its registry rows", async () => {
    const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
    client.state.sidekick = { id: "sidekick", name: "Sidekick", mark: "spark" };
    client.sidekickState = SK_ON;
    await renderIn("en", <SettingsPage client={client} state={client.state} tab="sidekick" onTab={() => {}} onChange={() => {}} onClose={() => {}} onSetup={() => {}} />);
    await waitFor(() => expect(shown()).toContain("sidekick.on"));
    expect(shown().sort()).toEqual(SEARCHABLE_SETTINGS.filter((s) => s.tab === "sidekick").map((s) => s.id).sort());
  });

  // One render per tab, with the state its rows need (§6): a row the registry names is drawn where it says.
  const MODELS: ModelsView = {
    recommended: { questions: "standard" },
    defaults: { claude: { light: { model: "haiku", effort: "low", cap: 100_000 }, standard: { model: "sonnet", effort: "medium", cap: 200_000 }, deep: { model: "opus", effort: "high", cap: 400_000 } } },
    offered: { claude: { models: [{ id: "haiku" }, { id: "sonnet" }, { id: "opus" }], efforts: ["low", "medium", "high"] } },
    pinnedTokens: 3000,
  };
  const registry = (tab: SearchSettingsTab) => SEARCHABLE_SETTINGS.filter((s) => s.tab === tab).map((s) => s.id);
  async function rowsOf(tab: SearchSettingsTab, setup: (c: FakeClient, state: AppState) => void) {
    const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" });
    setup(client, client.state);
    await renderIn("en", <SettingsPage client={client} state={client.state} tab={tab} onTab={() => {}} onChange={() => {}} onClose={() => {}} onSetup={() => {}} />);
    return client;
  }

  it("General with parallel and profiles renders their rows too", async () => {
    await rowsOf("general", (_, s) => {
      s.parallel = { caps: { tasks: 2, jobs: 1 }, suggested: { tasks: 2, jobs: 1 }, inbox: true, notifyWaiting: false };
      s.profiles = { label: "student", form: { fields: [{ name: "name", kind: "text", label: "Name", optional: false }] } };
    });
    await waitFor(() => expect(shown()).toContain("general.profiles"));
    for (const id of ["general.tasksAtOnce", "general.jobsAtOnce", "general.notifyWaiting", "general.profiles"]) expect(shown()).toContain(id);
  });

  it("Models renders its Tasks row on Tasks, its Levels row on Levels", async () => {
    await rowsOf("models", (_, s) => {
      s.models = MODELS;
    });
    await waitFor(() => expect(shown()).toEqual(["models.tasks"]));
    expect(registry("models")).toEqual(["models.tasks", "models.levels"]);
  });

  for (const [tab, setup] of [
    ["engine", () => {}],
    ["plugins", (c: FakeClient, s: AppState) => {
      s.plugins = { local: true };
      c.pluginsView = { local: true, plugins: [] };
    }],
    ["connections", (_: FakeClient, s: AppState) => {
      s.connections = { count: 0 };
    }],
    ["jobs", (_: FakeClient, s: AppState) => {
      s.jobs = { jobs: [] };
    }],
    ["usage", () => {}],
  ] as [SearchSettingsTab, (c: FakeClient, s: AppState) => void][]) {
    it(`${tab} renders exactly its registry rows`, async () => {
      await rowsOf(tab, setup);
      await waitFor(() => expect(shown().sort()).toEqual(registry(tab).sort()));
    });
  }
});
