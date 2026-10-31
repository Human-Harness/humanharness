import { describe, expect, it } from "vitest";
import { parsePluginManifest } from "@humanharness/harness-sdk";
import { searchFindings } from "../src/plugin-check";

const manifest = (panels: unknown[]) =>
  parsePluginManifest({
    id: "mini",
    name: "Mini",
    version: "0.1.0",
    api: 1,
    harness: "*",
    permissions: {},
    data: { items: { key: "id", agent: "read", schema: { type: "object", properties: { id: { type: "string" }, title: { type: "string" } }, required: ["id"] }, search: { title: "title" } } },
    panels,
  });

describe("plugin check: search-panel (search spec §7)", () => {
  it("warns when searchable data has no panel to open in", () => {
    expect(searchFindings(manifest([]))).toEqual([expect.objectContaining({ rule: "search-panel", severity: "warning", file: "dist/plugin.json" })]);
  });

  it("is quiet with a panel", () => {
    expect(searchFindings(manifest([{ id: "main", title: "Main" }]))).toEqual([]);
  });
});
