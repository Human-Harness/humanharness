import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allBlocks, blockToolName, loadHarness, resolveInHarness } from "@humanharness/harness-sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.resolve(here, "../harness.config.ts");
const REPO = path.resolve(here, "../../..");

describe("demo manifest", () => {
  it("is a read-only explainer of the app's own source", async () => {
    const h = await loadHarness(CONFIG);
    expect(h.permissions).toEqual({ edit: "none", exec: false, web: false });
    expect(h.folder.references).toEqual([{ id: "source", label: { es: "Código de Human Harness", en: "Human Harness source" }, default: "app-source" }]);
    const blocks = allBlocks(h);
    expect(Object.entries(blocks).map(([name, b]) => blockToolName(name, b))).toEqual(["show_choices", "save_note", "show_diagram", "show_files"]);
  });

  it("walks six topics in order, each brief starting from its curated doc", async () => {
    const h = await loadHarness(CONFIG);
    expect(h.path).toEqual(["manifest", "engines", "turn", "blocks", "context", "history"]);
    expect(Object.keys(h.actions)).toEqual(h.path);
    for (const id of h.path!) {
      const brief = fs.readFileSync(resolveInHarness(h, h.actions[id].prompt), "utf8");
      expect(brief).toMatch(/^# Topic: /);
      expect(brief).toContain(`docs/architecture/${id}.md`);
      expect(brief).toContain("{{notesIndex}}");
      expect(fs.existsSync(path.join(REPO, "docs", "architecture", `${id}.md`))).toBe(true);
      expect(h.actions[id].description?.es).toBeTruthy();
    }
  });

  it("runs the deep topics deep and free questions light (resources spec §9)", async () => {
    const h = await loadHarness(CONFIG);
    expect(Object.fromEntries(Object.entries(h.actions).map(([id, a]) => [id, a.tier]))).toEqual({
      manifest: "standard",
      engines: "standard",
      turn: "deep",
      blocks: "standard",
      context: "deep",
      history: "standard",
    });
    expect(h.questions).toEqual({ tier: "light" });
  });

  it("has the same strings in Spanish and English", () => {
    const keys = (o: Record<string, unknown>, prefix = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && v !== null ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]));
    const read = (l: string) => JSON.parse(fs.readFileSync(path.join(here, "..", "locales", `${l}.json`), "utf8")) as Record<string, unknown>;
    expect(keys(read("es")).sort()).toEqual(keys(read("en")).sort());
  });
});
