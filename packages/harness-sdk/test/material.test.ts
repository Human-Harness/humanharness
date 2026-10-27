import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STAGE_TIERS,
  type HarnessInput,
  MATERIAL_FAMILIES,
  MATERIAL_STAGE_KEYS,
  TIERS,
  defineHarness,
  hasMaterial,
  loadHarness,
  materialStageKey,
  stageTier,
  z,
} from "../src";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/material-harness/harness.config.ts");

const concepts = {
  scoped: true,
  key: "id",
  schema: z.object({ id: z.string(), name: z.string().min(1).max(80) }),
  agent: "write" as const,
};
const base: HarnessInput = {
  id: "reader",
  name: "Reader",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Reader" },
  instructions: "./AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  actions: { study: { label: "Study", prompt: "tasks/study.md", cost: "light" } },
  scopes: { label: "topic", plural: "topics" },
  data: { concepts },
  author: "t",
};
const sheet = { sections: [{ id: "terms", label: "Terms", prompt: "The key terms, one line each." }] };
const withMaterial: HarnessInput = { ...base, material: { sheet, items: { collection: "concepts", label: "name" } } };

function issues(input: HarnessInput): string[] {
  try {
    defineHarness(input);
    return [];
  } catch (e) {
    return (e as { issues: { path: PropertyKey[]; message: string }[] }).issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`);
  }
}

describe("material in the manifest (material spec §8)", () => {
  it("D0: a manifest without material has none", () => {
    const h = defineHarness(base);
    expect(h).not.toHaveProperty("material");
    expect(hasMaterial(h)).toBe(false);
  });

  it("fills the defaults", () => {
    const h = defineHarness(withMaterial);
    expect(hasMaterial(h)).toBe(true);
    expect(h.material).toEqual({
      accepts: [...MATERIAL_FAMILIES],
      sheet: { sections: sheet.sections, maxTokens: 800 },
      fragmentKinds: ["explanation", "definition", "example", "exercise"],
      items: { collection: "concepts", label: "name" },
      grounding: { default: "mixed", personCanChange: true },
      budget: { indexTokens: 600 },
      tiers: {},
    });
  });

  it("each stage has a tier, overridable, and a reserved models key", () => {
    const h = defineHarness({ ...withMaterial, material: { sheet, tiers: { label: "standard" } } });
    expect(stageTier(h.material!, "label")).toBe("standard");
    expect(stageTier(h.material!, "review")).toBe(DEFAULT_STAGE_TIERS.review);
    expect(DEFAULT_STAGE_TIERS).toEqual({ review: "standard", repair: "light", label: "light", sheet: "light", link: "standard" });
    expect(materialStageKey("review")).toBe("material-review");
    expect(MATERIAL_STAGE_KEYS).toEqual(["material-review", "material-repair", "material-label", "material-sheet", "material-link"]);
    // The stage tiers are the core's tiers.
    for (const t of Object.values(DEFAULT_STAGE_TIERS)) expect(TIERS).toContain(t);
  });

  it("items name a keyed collection and one of its fields", () => {
    expect(issues({ ...withMaterial, material: { sheet, items: { collection: "cards", label: "name" } } })).toContain(
      'material.items.collection: Collection "cards" is not declared in data',
    );
    expect(issues({ ...withMaterial, material: { sheet, items: { collection: "concepts", label: "title" } } })).toContain(
      'material.items.label: "title" is not a field of "concepts"',
    );
    const single = { scoped: false, single: true, schema: z.object({ name: z.string() }), agent: "read" as const };
    expect(issues({ ...withMaterial, data: { concepts, single }, material: { sheet, items: { collection: "single", label: "name" } } })).toContain(
      'material.items.collection: Fragments link to records by key: "single" needs a key, not single: true',
    );
  });

  it("sheet sections and kinds are unique, and the core's sheet sections are reserved", () => {
    const twice = { sections: [sheet.sections[0], sheet.sections[0]] };
    expect(issues({ ...withMaterial, material: { sheet: twice } })).toContain('material.sheet.sections: Section "terms" is declared twice');
    const core = { sections: [{ id: "notation", label: "Notation", prompt: "x" }] };
    expect(issues({ ...withMaterial, material: { sheet: core } })).toContain('material.sheet.sections: "notation" is a core sheet section');
    expect(issues({ ...withMaterial, material: { sheet, fragmentKinds: ["example", "example"] } })).toContain('material.fragmentKinds: "example" is listed twice');
    expect(issues({ ...withMaterial, material: { sheet, accepts: ["pdf", "pdf"] } })).toContain('material.accepts: "pdf" is listed twice');
  });

  it("with material, the stages' model keys are not action ids", () => {
    const actions = { ...base.actions, "material-review": { label: "Review", prompt: "tasks/study.md", cost: "light" as const } };
    expect(issues({ ...withMaterial, actions })).toContain('actions.material-review: "material-review" is reserved for a material stage: use another action id');
    // Without material the id is free (D0).
    expect(issues({ ...base, actions })).toEqual([]);
  });

  it("refuses bad bounds", () => {
    expect(issues({ ...withMaterial, material: { sheet, budget: { indexTokens: 10 } } }).some((i) => i.startsWith("material.budget"))).toBe(true);
    expect(issues({ ...withMaterial, material: { sheet: { sections: [] } } }).some((i) => i.startsWith("material.sheet.sections"))).toBe(true);
    expect(issues({ ...withMaterial, material: { sheet, accepts: ["images" as never] } }).some((i) => i.startsWith("material.accepts"))).toBe(true);
  });

  it("the fixture loads", async () => {
    const h = await loadHarness(fixture);
    expect(h.id).toBe("reader");
    expect(h.material?.items).toEqual({ collection: "concepts", label: "name" });
    expect(h.profiles?.label).toBe("student");
  });
});
