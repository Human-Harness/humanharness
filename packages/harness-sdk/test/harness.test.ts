import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { blockToolName, defineBlock, defineHarness, loadHarness, resolveInHarness } from "../src";

const DEMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../harnesses/demo/harness.config.ts");

const block = defineBlock({
  description: "A note.",
  visible: true,
  schema: z.object({ title: z.string() }),
  example: { title: "x" },
});

const base = {
  id: "test",
  name: { es: "Prueba", en: "Test" },
  core: "^0.1.0",
  languages: ["es", "en"] as const,
  engines: ["claude"],
  folder: { suggested: "Documents/Test" },
  instructions: "./AGENTS.md",
  permissions: { edit: "folder" as const, exec: false, web: false },
  blocks: { note: block },
  author: "Someone",
};

describe("defineBlock", () => {
  it("rejects an example that does not match the schema", () => {
    expect(() =>
      defineBlock({ description: "x", visible: true, schema: z.object({ n: z.number() }), example: { n: "no" } as never }),
    ).toThrow(/example/);
  });
});

describe("blockToolName", () => {
  it("uses show_ for visible blocks and update_ for state blocks", () => {
    expect(blockToolName("note", block)).toBe("show_note");
    expect(blockToolName("progress", { ...block, visible: false })).toBe("update_progress");
  });
});

describe("defineHarness", () => {
  it("fills defaults", () => {
    const h = defineHarness({ ...base, languages: [...base.languages] });
    expect(h.mcp).toEqual([]);
    expect(h.blocks.note).toBe(block);
  });

  it("rejects invalid block names", () => {
    expect(() => defineHarness({ ...base, languages: [...base.languages], blocks: { "Bad-Name": block } })).toThrow();
  });

  it("rejects an unknown language", () => {
    expect(() => defineHarness({ ...base, languages: ["fr" as never] })).toThrow();
  });
});

describe("loadHarness", () => {
  it("loads a manifest and records its root", async () => {
    const h = await loadHarness(DEMO);
    expect(h.id).toBe("demo");
    expect(h.root).toBe(path.dirname(DEMO));
    expect(h.configPath).toBe(DEMO);
    expect(resolveInHarness(h, h.instructions)).toBe(path.join(path.dirname(DEMO), "agent/AGENTS.md"));
    expect(Object.keys(h.blocks)).toEqual(["note", "progress"]);
  });
});
