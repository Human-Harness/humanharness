import { describe, expect, it } from "vitest";
import { defineHarness, pluginsAccepted } from "../src/index";
import { definePluginBackend } from "../src/plugin-backend";
// The smallest valid manifest the settings tests already share (no settings, no data).
import { base as baseInput } from "./settings-fixtures";

const base = () => ({ ...baseInput });

describe("manifest plugins (plugins spec §3.4)", () => {
  it("D0: a manifest without plugins parses to the same object as before", () => {
    const h = defineHarness(base());
    expect(h).not.toHaveProperty("plugins");
    expect(pluginsAccepted(h)).toBe(false);
  });

  it("fills defaults: local false, no bundled, none on", () => {
    const h = defineHarness({ ...base(), plugins: { bundled: ["oncall"] } });
    expect(h.plugins).toEqual({ bundled: ["oncall"], on: [], local: false });
    expect(pluginsAccepted(h)).toBe(true);
  });

  it("local only is accepted; an empty block accepts nothing", () => {
    expect(pluginsAccepted(defineHarness({ ...base(), plugins: { local: true } }))).toBe(true);
    expect(pluginsAccepted(defineHarness({ ...base(), plugins: {} }))).toBe(false);
  });

  it("on lists bundled plugins only, once", () => {
    expect(() => defineHarness({ ...base(), plugins: { bundled: ["a"], on: ["b"] } })).toThrow(/not bundled/);
    expect(() => defineHarness({ ...base(), plugins: { bundled: ["a"], on: ["a", "a"] } })).toThrow(/twice/);
    expect(() => defineHarness({ ...base(), plugins: { bundled: ["a", "a"] } })).toThrow(/twice/);
    expect(() => defineHarness({ ...base(), plugins: { bundled: ["Bad"] } })).toThrow();
    expect(() => defineHarness({ ...base(), plugins: { bundled: [], extra: true } as never })).toThrow();
  });

  it("definePluginBackend returns its argument (the build bundles it)", () => {
    const b = { sources: { queues: async () => {} } };
    expect(definePluginBackend(b)).toBe(b);
  });
});
