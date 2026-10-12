import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { CORE_BLOCKS, TIERS, allBlocks, blockToolName, choicesSchema, defineBlock, defineHarness, loadHarness, resolveInHarness, saveNoteSchema } from "../src";

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

  it("declares actions with a prompt and a cost hint, empty by default", () => {
    expect(defineHarness({ ...base, languages: [...base.languages] }).actions).toEqual({});
    const research = { label: { es: "Investigar", en: "Research" }, prompt: "./agent/tasks/research.md", cost: "heavy" as const };
    const h = defineHarness({ ...base, languages: [...base.languages], actions: { research } });
    expect(h.actions.research).toEqual(research);
    expect(() =>
      defineHarness({ ...base, languages: [...base.languages], actions: { research: { ...research, cost: "huge" as never } } }),
    ).toThrow();
    expect(() => defineHarness({ ...base, languages: [...base.languages], actions: { "Bad Name": research } })).toThrow();
    expect(() =>
      defineHarness({ ...base, languages: [...base.languages], actions: { research: { label: research.label, cost: "light" } as never } }),
    ).toThrow();
  });

  it("orders actions in an optional guided path", () => {
    const actions = {
      turn: { label: { es: "Un turno", en: "A turn" }, description: { es: "De punta a punta", en: "End to end" }, prompt: "./agent/tasks/turn.md", cost: "medium" as const },
      blocks: { label: { es: "Bloques", en: "Blocks" }, prompt: "./agent/tasks/blocks.md", cost: "light" as const },
    };
    const h = defineHarness({ ...base, languages: [...base.languages], actions, path: ["turn", "blocks"] });
    expect(h.path).toEqual(["turn", "blocks"]);
    expect(h.actions.turn.description).toEqual({ es: "De punta a punta", en: "End to end" });
    expect(defineHarness({ ...base, languages: [...base.languages], actions }).path).toBeUndefined();
    expect(() => defineHarness({ ...base, languages: [...base.languages], actions, path: ["turn", "nope"] })).toThrow(/nope/);
    expect(() => defineHarness({ ...base, languages: [...base.languages], actions, path: ["turn", "turn"] })).toThrow(/twice/);
    expect(() => defineHarness({ ...base, languages: [...base.languages], actions, path: [] })).toThrow();
  });

  it("declares read-only reference folders", () => {
    const ref = (d: string, id = "source") => ({ id, label: { es: "Código", en: "Source" }, default: d });
    const withRefs = (references: ReturnType<typeof ref>[]) =>
      defineHarness({ ...base, languages: [...base.languages], folder: { suggested: "Documents/Test", references } });
    expect(withRefs([ref("app-source")]).folder.references).toEqual([ref("app-source")]);
    expect(defineHarness({ ...base, languages: [...base.languages] }).folder.references).toEqual([]);
    expect(() => withRefs([ref("~/code/x"), ref("/opt/x", "other")])).not.toThrow();
    expect(() => withRefs([ref("relative/x")])).toThrow(/app-source/);
    expect(() => withRefs([ref("app-source"), ref("/opt/x")])).toThrow(/twice/);
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

  it("rejects action prompts outside the harness folder", async () => {
    const dir = fs.mkdtempSync(path.join(root, "t-"));
    const file = path.join(dir, "harness.config.mjs");
    const manifest = {
      id: "x",
      name: { es: "X", en: "X" },
      core: "^0.1.0",
      languages: ["es"],
      engines: ["claude"],
      folder: { suggested: "Documents/X" },
      instructions: "./AGENTS.md",
      permissions: { edit: "none", exec: false, web: false },
      blocks: {},
      actions: { a: { label: { es: "A", en: "A" }, prompt: "../../outside.md", cost: "light" } },
      author: "x",
    };
    fs.writeFileSync(file, `export default ${JSON.stringify(manifest)};`);
    await expect(loadHarness(file)).rejects.toThrow("Path escapes the harness folder: ../../outside.md");
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

  it("validates block tool names and keeps them unique, core tools included", () => {
    const withBlocks = (blocks: Record<string, typeof block>) => () => defineHarness({ ...base, languages: [...base.languages], blocks });
    expect(withBlocks({ note: { ...block, tool: "make_note" } })).not.toThrow();
    expect(withBlocks({ note: { ...block, tool: "Bad-Tool" } })).toThrow();
    expect(withBlocks({ note: { ...block, tool: "" } })).toThrow();
    expect(withBlocks({ note: { ...block, tool: "save_note" } })).toThrow(/save_note/);
    expect(withBlocks({ note: { ...block, tool: "show_choices" } })).toThrow(/show_choices/);
    expect(withBlocks({ note: block, other: { ...block, tool: "show_note" } })).toThrow(/show_note/);
  });

  it("documents choices as up to 4 options and the action > next > followUp precedence", () => {
    expect(CORE_BLOCKS.choices.description).not.toMatch(/2 to 4/);
    expect(CORE_BLOCKS.choices.description).toMatch(/up to 4/);
    expect(CORE_BLOCKS.choices.description).toMatch(/action.*next.*followUp/s);
  });
});

describe("tiers", () => {
  it("lists the three abstract tiers, lightest first", () => {
    expect(TIERS).toEqual(["light", "standard", "deep"]);
  });

  it("lets actions and free questions declare a tier; custom is a user setting only", () => {
    const research = { label: { es: "Investigar", en: "Research" }, prompt: "./agent/tasks/research.md", cost: "heavy" as const, tier: "deep" as const };
    const h = defineHarness({ ...base, languages: [...base.languages], actions: { research }, questions: { tier: "light" } });
    expect(h.actions.research.tier).toBe("deep");
    expect(h.questions).toEqual({ tier: "light" });
    const plain = defineHarness({ ...base, languages: [...base.languages], actions: { research: { ...research, tier: undefined } } });
    expect(plain.actions.research.tier).toBeUndefined();
    expect(plain.questions).toBeUndefined();
    expect(() => defineHarness({ ...base, languages: [...base.languages], actions: { research: { ...research, tier: "custom" as never } } })).toThrow();
    expect(() => defineHarness({ ...base, languages: [...base.languages], questions: { tier: "huge" as never } })).toThrow();
  });

  it("reserves \"questions\" as an action id: free questions' model setting lives under that key", () => {
    const research = { label: { es: "Investigar", en: "Research" }, prompt: "./agent/tasks/research.md", cost: "heavy" as const };
    expect(() => defineHarness({ ...base, languages: [...base.languages], actions: { questions: research } })).toThrow(/reserved/);
  });

  it("caps action ids at 64 characters, as the models config keys", () => {
    const research = { label: { es: "Investigar", en: "Research" }, prompt: "./agent/tasks/research.md", cost: "heavy" as const };
    const id64 = `a${"b".repeat(63)}`;
    expect(Object.keys(defineHarness({ ...base, languages: [...base.languages], actions: { [id64]: research } }).actions)).toEqual([id64]);
    expect(() => defineHarness({ ...base, languages: [...base.languages], actions: { [`${id64}c`]: research } })).toThrow();
  });
});
