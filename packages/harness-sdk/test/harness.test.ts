import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { CORE_BLOCKS, allBlocks, blockToolName, choicesSchema, defineBlock, defineHarness, loadHarness, resolveInHarness, saveNoteSchema } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/notes-harness/harness.config.ts");

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
    expect(() => defineHarness({ ...base, languages: [...base.languages], blocks: { "Bad-Name": block } })).toThrow(/Bad-Name/);
  });

  it("rejects things that are not real blocks", () => {
    const run = (b: unknown) => () => defineHarness({ ...base, languages: [...base.languages], blocks: { note: b as never } });
    expect(run({ schema: 1, description: "x", visible: true, example: {} })).toThrow();
    expect(run({ schema: z.object({}), description: "x", example: {} })).toThrow();
    expect(run({ schema: z.object({ n: z.number() }), description: "x", visible: true, example: { n: "no" } })).toThrow();
  });

  it("rejects an unknown language", () => {
    expect(() => defineHarness({ ...base, languages: ["fr" as never] })).toThrow();
  });

  it("declares actions with a cost hint, empty by default", () => {
    expect(defineHarness({ ...base, languages: [...base.languages] }).actions).toEqual({});
    const h = defineHarness({
      ...base,
      languages: [...base.languages],
      actions: { research: { label: { es: "Investigar", en: "Research" }, cost: "heavy" } },
    });
    expect(h.actions.research).toEqual({ label: { es: "Investigar", en: "Research" }, cost: "heavy" });
    expect(() =>
      defineHarness({ ...base, languages: [...base.languages], actions: { research: { label: { es: "x", en: "x" }, cost: "huge" as never } } }),
    ).toThrow();
    expect(() =>
      defineHarness({ ...base, languages: [...base.languages], actions: { "Bad Name": { label: { es: "x", en: "x" }, cost: "light" } } }),
    ).toThrow();
  });

  it("takes an optional tagline and logo for the home screen", () => {
    const h = defineHarness({
      ...base,
      languages: [...base.languages],
      tagline: { es: "Tus notas, ordenadas", en: "Your notes, tidy" },
      logo: "./ui/logo.svg",
    });
    expect([h.tagline?.en, h.logo]).toEqual(["Your notes, tidy", "./ui/logo.svg"]);
    expect(defineHarness({ ...base, languages: [...base.languages] }).tagline).toBeUndefined();
  });
});

describe("loadHarness", () => {
  it("loads a manifest and records its root", async () => {
    const h = await loadHarness(FIXTURE);
    expect(h.id).toBe("notes");
    expect(h.root).toBe(path.dirname(FIXTURE));
    expect(h.configPath).toBe(FIXTURE);
    expect(resolveInHarness(h, h.instructions)).toBe(path.join(path.dirname(FIXTURE), "agent/AGENTS.md"));
    expect(Object.keys(h.blocks)).toEqual(["note", "progress"]);
  });

  it("throws when the module has no default export", async () => {
    const dir = fs.mkdtempSync(path.join(root, "t-"));
    const file = path.join(dir, "harness.config.ts");
    fs.writeFileSync(file, "export const x = 1;");
    await expect(loadHarness(file)).rejects.toThrow(`${file} has no default export`);
  });

  it("accepts a root override for compiled manifests", async () => {
    const h = await loadHarness(FIXTURE, { root: "/somewhere/else" });
    expect(h.root).toBe("/somewhere/else");
    expect(h.configPath).toBe(FIXTURE);
  });
});

describe("resolveInHarness", () => {
  it("rejects paths that escape the harness folder", async () => {
    const h = await loadHarness(FIXTURE);
    expect(() => resolveInHarness(h, "../../etc/passwd")).toThrow("Path escapes the harness folder: ../../etc/passwd");
  });
});

describe("core blocks", () => {
  it("offers choices (visible, show_choices) and save_note (hidden, its own tool name)", () => {
    expect(blockToolName("choices", CORE_BLOCKS.choices)).toBe("show_choices");
    expect(blockToolName("save_note", CORE_BLOCKS.save_note)).toBe("save_note");
    expect(CORE_BLOCKS.choices.visible).toBe(true);
    expect(CORE_BLOCKS.save_note.visible).toBe(false);
  });

  it("validates choice options and notes", () => {
    expect(choicesSchema.safeParse({ options: [{ label: "Next topic", next: true }] }).success).toBe(true);
    expect(choicesSchema.safeParse({ options: [{ label: "Deeper", followUp: "Tell me more", action: "turn" }] }).success).toBe(true);
    expect(choicesSchema.safeParse({ options: [] }).success).toBe(false);
    expect(choicesSchema.safeParse({ options: [{ label: "x", next: false }] }).success).toBe(false);
    const note = { title: "T", summary: ["a"], decisions: [], files: [], open: [] };
    expect(saveNoteSchema.safeParse(note).success).toBe(true);
    expect(saveNoteSchema.safeParse({ ...note, summary: ["a", "b", "c", "d", "e", "f"] }).success).toBe(false);
    expect(saveNoteSchema.safeParse({ ...note, summary: [] }).success).toBe(false);
    expect(saveNoteSchema.safeParse({ ...note, title: "" }).success).toBe(false);
  });

  it("adds the core blocks to the harness's and reserves their names", () => {
    const h = defineHarness({ ...base, languages: [...base.languages] });
    expect(Object.keys(allBlocks(h))).toEqual(["choices", "save_note", "note"]);
    expect(() => defineHarness({ ...base, languages: [...base.languages], blocks: { choices: block } })).toThrow(/core block/);
    expect(() => defineHarness({ ...base, languages: [...base.languages], blocks: { save_note: block } })).toThrow(/core block/);
  });
});
