import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { workerBuild } from "../src/main/search/runner";
import { SearchService } from "../src/main/search/service";

// Opt-in (plan deviation 19): HH_SEARCH_BUDGET=1 corepack pnpm vitest run packages/shell/test/search-budget.test.ts
// HH_SEARCH_BUDGET_DIR=<folder> measures a real folder (the demo's, a large repo) instead of the generated one.
const on = process.env.HH_SEARCH_BUDGET === "1";
const WORDS = ["context", "window", "engine", "turn", "note", "harness", "budget", "scope", "reader", "history", "task", "plan"];

describe.skipIf(!on)("search budgets (§4.4)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-search-budget-"));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("10,000 files: names, text, query p95, disk and heap", async () => {
    let base = process.env.HH_SEARCH_BUDGET_DIR;
    if (!base) {
      base = path.join(tmp, "Work");
      for (let i = 0; i < 10_000; i++) {
        const dir = path.join(base, `d${i % 100}`);
        fs.mkdirSync(dir, { recursive: true });
        const text = Array.from({ length: 200 }, (_, k) => WORDS[(i * 7 + k) % WORDS.length]).join(" ");
        fs.writeFileSync(path.join(dir, `f${i}.md`), `# File ${i}\n\n${text}\n`);
      }
    }
    const statuses: { state: string; at: number }[] = [];
    const t0 = performance.now();
    const heap0 = process.memoryUsage().heapUsed;
    const svc = new SearchService({
      userData: () => path.join(tmp, "userData"),
      base: async () => base!,
      scoped: () => false,
      openScope: async () => null,
      scopeTitles: async () => new Map(),
      references: async () => [],
      memory: async () => [],
      extraDenied: async () => [],
      status: (s) => statuses.push({ state: s.state, at: performance.now() - t0 }),
      runner: workerBuild(),
      reveal: async () => true,
    });
    await svc.query("", {});
    await svc.whenIdle();
    const names = statuses.find((s) => s.state === "names")?.at ?? NaN;
    const ready = statuses.findLast((s) => s.state === "ready")?.at ?? NaN;
    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      const q = `${WORDS[i % WORDS.length]} ${WORDS[(i + 3) % WORDS.length].slice(0, 4)}`;
      const a = performance.now();
      await svc.query(q, {});
      times.push(performance.now() - a);
    }
    times.sort((a, b) => a - b);
    await svc.flush();
    const dir = path.join(tmp, "userData", "search");
    const sub = path.join(dir, fs.readdirSync(dir)[0]);
    const disk = fs.readdirSync(sub).reduce((n, f) => n + fs.statSync(path.join(sub, f)).size, 0);
    // The text the index holds, to compare the disk with (§4.4 "at most 30% of the indexed text").
    const meta = JSON.parse(fs.readFileSync(path.join(sub, "files.json"), "utf8")) as { files: Record<string, { size: number; how: string }> };
    const indexed = Object.values(meta.files).filter((f) => f.how === "text");
    const textBytes = indexed.reduce((n, f) => n + f.size, 0);
    const heap = process.memoryUsage().heapUsed - heap0;
    console.log(
      JSON.stringify(
        { files: Object.keys(meta.files).length, textFiles: indexed.length, namesMs: Math.round(names), textMs: Math.round(ready), queryP95Ms: Math.round(times[94]), diskBytes: disk, textBytes, diskPct: Math.round((disk / textBytes) * 1000) / 10, heapBytes: heap },
        null,
        2,
      ),
    );
    expect(ready).toBeGreaterThan(0);
  }, 600_000);
});
