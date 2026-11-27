// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createI18n } from "@humanharness/i18n";
import { type BlockRegistry, createBlockRegistry } from "../../../ui/src/layout/registry";
import { commandRows, settingRows } from "../../search/src/local";
import { tabLabel, visibleTabs } from "../../../ui/src/settings-tabs";
import { FakeClient } from "../../../ui/test/fake-client";
import { usageRegistry } from "../../../ui/test/usage-mod";

const state = () => new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" }).state;

describe("the usage mod's Settings tab", () => {
  it("is on the list where the core drew it, last and after Jobs, while the mod is on", () => {
    const s = { ...state(), jobs: { jobs: [], runs: [] } } as never;
    const tabs = visibleTabs(s, usageRegistry());
    expect(tabs.at(-1)).toBe("usage");
    expect(tabs.indexOf("jobs")).toBe(tabs.indexOf("usage") - 1);
  });

  it("is gone with the mod off: no tab, and search offers no usage row", async () => {
    const off: BlockRegistry = createBlockRegistry();
    expect(visibleTabs(state(), off)).not.toContain("usage");
    const i18n = await createI18n("en");
    expect(settingRows(i18n.t, state(), "usage", off).map((r) => r.id)).toEqual([]);
    expect(commandRows(i18n.t, state(), "", null, [], null, off).map((r) => r.id)).not.toContain("command:open-settings:usage");
  });

  it("keeps the name Usage and the search rows that open it", async () => {
    const i18n = await createI18n("en");
    const registry = usageRegistry();
    expect(tabLabel(i18n.t, state(), "usage", registry)).toBe("Usage");
    expect(settingRows(i18n.t, state(), "usage", registry).map((r) => r.id)).toEqual(["setting:usage.plan", "setting:usage.actions"]);
  });
});
