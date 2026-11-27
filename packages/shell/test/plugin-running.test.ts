import { describe, expect, it } from "vitest";
import { runningPlugins } from "../src/main/plugin-running";

describe("runningPlugins", () => {
  it("a change in which plugins run (or their versions) changes the text, a sync time or an error does not", () => {
    const row = (id: string, status: "on" | "off", extra = {}) => ({ id, name: id, version: "1.0.0", origin: "bundled" as const, status, ...extra });
    const on = runningPlugins({ local: false, plugins: [row("b", "on"), row("a", "on"), row("c", "off")] });
    expect(runningPlugins({ local: false, plugins: [row("a", "on", { lastSync: "now" }), row("b", "on"), row("c", "off", { lastError: "x" })] })).toBe(on);
    expect(runningPlugins({ local: false, plugins: [row("a", "on"), row("b", "off")] })).not.toBe(on);
    expect(runningPlugins({ local: false, plugins: [row("a", "on"), { ...row("b", "on"), version: "2.0.0" }] })).not.toBe(on);
  });
});
