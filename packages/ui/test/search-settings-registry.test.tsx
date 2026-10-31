// @vitest-environment happy-dom
import fs from "node:fs";
import path from "node:path";
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SEARCHABLE_SETTINGS } from "@humanharness/protocol";
import { SettingsSheet } from "../src/SettingsSheet";
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
    await renderIn("en", <SettingsSheet client={client} state={state} tab="general" onTab={() => {}} onChange={() => {}} onClose={() => {}} onSetup={() => {}} />);
    await waitFor(() => expect(shown()).toContain("general.appearance"));
    expect(shown().sort()).toEqual(["general.appearance", "general.folder", "general.language", "general.textSize", ...(state.backup?.status ? ["general.backup"] : [])].sort());
  });

  it("Sidekick renders exactly its registry rows", async () => {
    const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
    client.state.sidekick = { id: "sidekick", name: "Sidekick", mark: "spark" };
    client.sidekickState = SK_ON;
    await renderIn("en", <SettingsSheet client={client} state={client.state} tab="sidekick" onTab={() => {}} onChange={() => {}} onClose={() => {}} onSetup={() => {}} />);
    await waitFor(() => expect(shown()).toContain("sidekick.on"));
    expect(shown().sort()).toEqual(SEARCHABLE_SETTINGS.filter((s) => s.tab === "sidekick").map((s) => s.id).sort());
  });
});
