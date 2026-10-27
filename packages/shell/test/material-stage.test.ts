import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getEngine } from "@humanharness/engines";
import { MaterialStore, STAGES } from "@humanharness/material";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MaterialService } from "../src/main/material";
import { type MaterialStageDeps, runMaterialStage } from "../src/main/material-stage";
import type { UsageRecord } from "../src/main/usage-log";

let base: string;
let runs: number;
let logged: UsageRecord[];
let notice: boolean;
const profile = { engine: "claude", tier: "light" as const, effort: "low" as const, cap: 100_000 };

const deps = (over: Partial<MaterialStageDeps> = {}): MaterialStageDeps => ({
  setup: async () => ({ engineId: "claude", base }),
  hasNotice: async () => notice,
  engine: getEngine,
  command: async () => ({ command: ["claude"], env: {} }),
  profile: async () => profile,
  run: async () => {
    runs++;
    return { ok: true, usage: { inputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
  },
  log: async (_b, r) => void logged.push(r),
  ...over,
});

const job = { scope: "fractions", source: "a", stage: "review" as const };

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "hh-mstage-"));
  runs = 0;
  logged = [];
  notice = true;
});
afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
  delete STAGES.review;
});

describe("runMaterialStage (material spec §10)", () => {
  it("runs the session and writes one usage line", async () => {
    expect(await runMaterialStage(deps(), job, "Review.", [], async () => null, new AbortController().signal)).toEqual({ ok: true });
    expect(runs).toBe(1);
    expect(logged).toEqual([expect.objectContaining({ phase: "material", stage: "review", scope: "fractions", source: "a", ok: true })]);
  });

  it("without the engine's notice accepted, no session runs and the stage fails", async () => {
    notice = false;
    expect(await runMaterialStage(deps(), job, "Review.", [], async () => null, new AbortController().signal)).toEqual({ ok: false });
    expect(runs).toBe(0);
    expect(logged).toEqual([]);
  });

  it("a stopped stage writes no line; a missing CLI or app fails", async () => {
    const stop = new AbortController();
    const d = deps({
      run: async () => {
        stop.abort();
        return { ok: false };
      },
    });
    expect(await runMaterialStage(d, job, "x", [], async () => null, stop.signal)).toEqual({ ok: false });
    expect(logged).toEqual([]);
    expect(await runMaterialStage(deps({ command: async () => null }), job, "x", [], async () => null, new AbortController().signal)).toEqual({ ok: false });
    expect(await runMaterialStage(deps({ setup: async () => null }), job, "x", [], async () => null, new AbortController().signal)).toEqual({ ok: false });
    expect(runs).toBe(0);
  });

  it("through the service: no notice marks the source as not checked by the AI", async () => {
    notice = false;
    const store = new MaterialStore(base, "fractions");
    await store.update(() => [
      {
        id: "a",
        scope: "fractions",
        path: "a.md",
        hash: "x",
        type: "md",
        family: "text",
        pages: 1,
        sizeBytes: 1,
        skippedPages: [],
        status: "validating",
        stage: "review",
        issues: [],
        fixes: [],
        estimate: 0,
        used: 0,
        fragments: [],
        addedAt: "2026-10-27T00:00:00.000Z",
      },
    ]);
    STAGES.review = { tools: [], prompt: async () => "Review.", accept: async () => "", apply: async () => true };
    const svc = new MaterialService({
      material: {
        accepts: ["text"],
        grounding: { default: "mixed", personCanChange: true },
        budget: { indexTokens: 600 },
        fragmentKinds: ["explanation"],
        sheet: { sections: [{ id: "terms", label: "Key terms", prompt: "List them." }], maxTokens: 800 },
        tiers: {},
      },
      base: async () => base,
      scopeOk: async (s) => s === "fractions",
      pickFiles: async () => null,
      trash: async () => undefined,
      fetchLink: async () => ({ ok: false }),
      send: () => undefined,
      provider: async () => "Anthropic",
      window: async () => null,
      afterChange: async () => undefined,
      runStage: (j, p, t, h, s) => runMaterialStage(deps(), j, p, t, h, s),
    });
    await svc.runJob(job, new AbortController().signal);
    expect(await store.source("a")).toMatchObject({ status: "ready", failed: "review" });
  });
});
