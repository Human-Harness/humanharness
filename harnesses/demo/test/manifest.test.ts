import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allBlocks, blockToolName, loadHarness, resolveInHarness } from "@humanharness/harness-sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.resolve(here, "../harness.config.ts");
const REPO = path.resolve(here, "../../..");

describe("demo manifest", () => {
  it("is English with a tone for its translations", async () => {
    const harness = await loadHarness(CONFIG);
    expect(harness.name).toBe("Demo");
    expect(harness.actions.turn.label).toBe("A turn end to end");
    expect(harness.tone).toBe("clear and friendly, for developers; short sentences");
  });

  it("is a read-only explainer of the app's own source", async () => {
    const h = await loadHarness(CONFIG);
    expect(h.permissions).toEqual({ edit: "none", exec: false, web: false });
    expect(h.folder.references).toEqual([{ id: "source", label: "Human Harness source", default: "app-source" }]);
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
      expect(h.actions[id].description).toBeTruthy();
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

  it("declares an echo backend inside the harness folder (hatches spec §4)", async () => {
    const h = await loadHarness(CONFIG);
    expect(h.backend).toBe("./backend/index.ts");
    const entry = resolveInHarness(h, h.backend!);
    expect(entry).toBe(path.resolve(here, "../backend/index.ts"));
    expect(fs.existsSync(entry)).toBe(true);
  });
});
