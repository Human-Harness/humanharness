import { describe, expect, it } from "vitest";
import { DEFAULT_SLOTS, defineHarness, harnessSlots, parsePluginManifest, slotFor } from "../src";
import { base as baseInput } from "./settings-fixtures";

const base = () => ({ ...baseInput });
const plugin = (extra: object = {}) => parsePluginManifest({ id: "p", name: "P", version: "1.0.0", api: 1, harness: "*", permissions: {}, ...extra });

describe("slots (spec §3.4, Decision 1)", () => {
  it("D0: a manifest without slots parses to the same object as before", () => {
    const h = defineHarness(base());
    expect(h).not.toHaveProperty("slots");
    expect(harnessSlots(h)).toEqual(DEFAULT_SLOTS);
  });
  it("declared slots come after the defaults; reserved ids, duplicates and bad kinds are refused", () => {
    const h = defineHarness({ ...base(), slots: [{ id: "bottom", label: "Bottom panel", kind: "panel" }, { id: "status-bar", label: "Status bar", kind: "chip" }] });
    expect(harnessSlots(h).map((s) => s.id)).toEqual(["plugins", "chips", "bottom", "status-bar"]);
    expect(() => defineHarness({ ...base(), slots: [{ id: "plugins", label: "X", kind: "panel" }] })).toThrow(/reserved/);
    expect(() => defineHarness({ ...base(), slots: [{ id: "a", label: "A", kind: "panel" }, { id: "a", label: "A", kind: "chip" }] })).toThrow(/twice/);
    expect(() => defineHarness({ ...base(), slots: [{ id: "a", label: "A", kind: "dock" as never }] })).toThrow();
  });
  it("a panel or chip without slot, with an unknown slot or one of the other kind falls back to the default of its kind", () => {
    const h = defineHarness({ ...base(), slots: [{ id: "bottom", label: "Bottom", kind: "panel" }, { id: "status-bar", label: "Status", kind: "chip" }] });
    expect(slotFor(h, "panel", undefined)).toBe("plugins");
    expect(slotFor(h, "panel", "bottom")).toBe("bottom");
    expect(slotFor(h, "panel", "sidebar")).toBe("plugins");
    expect(slotFor(h, "panel", "status-bar")).toBe("plugins");
    expect(slotFor(h, "chip", "status-bar")).toBe("status-bar");
    expect(slotFor(h, "chip", "bottom")).toBe("chips");
  });
  it("plugin.json panels and chips may leave out slot", () => {
    const m = plugin({ panels: [{ id: "queue", title: "Queue" }], chips: [{ id: "who" }] });
    expect(m.panels[0].slot).toBeUndefined();
    expect(m.chips[0].slot).toBeUndefined();
  });
});
