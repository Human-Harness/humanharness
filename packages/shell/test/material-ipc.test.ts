import { DATA_PREFIX, MATERIAL_KEEP, NOTES_PREFIX } from "@humanharness/workspace";
import { describe, expect, it } from "vitest";
import { historyKeep, materialAppState, openMaterial } from "../src/main/material-ipc";

const material = { accepts: ["text", "pdf"] as ("text" | "pdf")[], grounding: { default: "mixed" as const, personCanChange: true } };

describe("D0: a harness without material", () => {
  it("keeps today's history keep list; with material the registry is kept too", () => {
    expect(historyKeep({})).toEqual([NOTES_PREFIX, DATA_PREFIX]);
    expect(historyKeep({ material })).toEqual([NOTES_PREFIX, DATA_PREFIX, MATERIAL_KEEP]);
  });
  it("adds no `material` key to AppState", () => {
    const state = { name: "x", ...materialAppState({}) };
    expect(Object.hasOwn(state, "material")).toBe(false);
    expect(materialAppState({ material })).toEqual({ material: { accepts: ["text", "pdf"], items: false, grounding: { default: "mixed", personCanChange: true } } });
    expect(materialAppState({ material: { ...material, items: { collection: "concepts", label: "name" } } }).material?.items).toBe(true);
  });
});

describe("openMaterial (hh:materialOpen)", () => {
  const opened: string[] = [];
  const open = async (file: string) => {
    opened.push(file);
    return file.endsWith("broken.pdf") ? "No app" : "";
  };
  const svc = { originalOf: async (_scope: unknown, id: unknown) => (id === "ch2" ? "/b/material/main/ch2.pdf" : id === "bad" ? "/b/material/main/broken.pdf" : null) };
  it("without material: not-ready; an unknown id: unknown-source; otherwise opened", async () => {
    expect(await openMaterial(null, "main", "ch2", open)).toEqual({ ok: false, reason: "not-ready" });
    expect(await openMaterial(svc, "main", "nope", open)).toEqual({ ok: false, reason: "unknown-source" });
    expect(await openMaterial(svc, "main", "ch2", open)).toEqual({ ok: true });
    expect(await openMaterial(svc, "main", "bad", open)).toEqual({ ok: false, reason: "invalid" });
    expect(opened).toEqual(["/b/material/main/ch2.pdf", "/b/material/main/broken.pdf"]);
  });
});
