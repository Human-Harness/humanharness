import { describe, expect, it } from "vitest";
import { z } from "zod";
import { definePlugin, parsePluginManifest, pluginJson } from "../src";

const def = () =>
  definePlugin({
    id: "oncall", name: "On-call", version: "1.0.0", harness: "*",
    permissions: { hosts: ["api.example.com"], tasks: true },
    sources: [{ id: "queues", ttl: 300 }],
    data: { queues: { key: "id", agent: "read", schema: z.object({ id: z.string(), count: z.number().int().min(0) }) } },
    panels: [{ id: "queue", title: "Queue" }],
    actions: [{ id: "triage", label: "Triage", tier: "light", scope: "none", vars: z.object({ key: z.string().max(20) }), prompt: "Triage {{key}}." }],
  });

describe("definePlugin → plugin.json (Decision 16)", () => {
  it("turns zod into allowlisted JSON Schema that parsePluginManifest accepts", () => {
    const json = pluginJson(def());
    expect(json.api).toBe(1);
    expect(json.data?.queues.schema).toEqual({ type: "object", properties: { id: { type: "string" }, count: { type: "integer", minimum: 0 } }, required: ["id", "count"], additionalProperties: false });
    expect(JSON.stringify(json)).not.toContain("$schema");
    expect(() => parsePluginManifest(json)).not.toThrow();
  });
  it("a zod regex (JSON Schema `pattern`) fails with the allowlist's message (B11)", () => {
    const d = def();
    d.data!.queues.schema = z.object({ id: z.string().regex(/^[A-Z]+$/) });
    expect(() => pluginJson(d)).toThrow(/"pattern" is not supported/);
  });
  it("a transform or other unrepresentable schema fails the build", () => {
    const d = def();
    d.data!.queues.schema = z.object({ id: z.string().transform((s) => s.length) }) as never;
    expect(() => pluginJson(d)).toThrow();
  });
  it("output is plain data: JSON round trip is identity", () => {
    const json = pluginJson(def());
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });
});
