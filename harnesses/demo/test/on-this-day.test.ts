import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import backend from "../plugins/on-this-day/backend";
import { loadHarness, pluginsAccepted } from "@humanharness/harness-sdk";
import { buildPlugin } from "../../../packages/cli/src/plugin-build";
import { checkPlugin } from "../../../packages/cli/src/plugin-check";
import { readBuiltManifest } from "../../../packages/cli/src/plugin-run";
import { testPlugin } from "../../../packages/cli/src/plugin-test";

// The demo's bundled plugin (plugins spec §10, Decision 25), as committed: its dist/, its fixture and its PLUGIN.md.
// Everything runs on the hand-made fixture; nothing here reaches the network.

const here = path.dirname(fileURLToPath(import.meta.url));
const DEMO = path.resolve(here, "..");
const DIR = path.join(DEMO, "plugins", "on-this-day");

/** Every file under `dir`, relative, sorted. */
function files(dir: string, rel = ""): string[] {
  return fs
    .readdirSync(path.join(dir, rel), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(dir, path.join(rel, e.name)) : [path.join(rel, e.name)]))
    .sort();
}

/** Local noon on that day: the plugin asks for the person's local date. */
const day = (year: number, month = 10, date = 27) => new Date(year, month - 1, date, 12);

describe("the on-this-day plugin as committed", () => {
  let tmp: string;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-on-this-day-"));
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("checks with no finding at all, against the demo harness too", async () => {
    const { manifest, findings } = await checkPlugin(DIR, { build: false, harness: DEMO });
    expect(findings).toEqual([]);
    expect(manifest?.id).toBe("on-this-day");
  });

  it("has a committed dist/ byte-identical to a fresh build (a source change without a rebuild fails here)", async () => {
    const out = path.join(tmp, "dist");
    const built = await buildPlugin(DIR, { out });
    const committed = path.join(DIR, "dist");
    expect(files(committed)).toEqual(files(out));
    for (const f of built.files) expect(fs.readFileSync(path.join(committed, f)).equals(fs.readFileSync(path.join(out, f))), f).toBe(true);
  }, 120_000);

  it("is the guide's complete example: a source, a collection, a panel, a chip, an attention rule and an action", async () => {
    const m = await readBuiltManifest(DIR);
    expect(m.permissions).toMatchObject({ hosts: ["api.wikimedia.org"], exec: [], secrets: [], tasks: true });
    expect(m.sources).toEqual([expect.objectContaining({ id: "events", ttl: 21_600 })]);
    expect(m.data.events).toMatchObject({ key: "id", agent: "read" });
    expect(m.settings?.fields.count).toMatchObject({ default: 25, schema: { minimum: 5, maximum: 50 } });
    expect(m.panels).toEqual([{ id: "events", title: "On this day" }]);
    expect(m.chips).toEqual([{ id: "today" }]);
    expect(m.actions).toEqual([expect.objectContaining({ id: "explain", tier: "light", scope: "none" })]);
    expect(m.actions[0].vars).toMatchObject({ required: ["year", "text"], properties: { year: { type: "integer" }, text: { type: "string" } } });
    // The guide's rule: an action proposes, and the agent changes nothing outside the app without the person's yes.
    expect(m.actions[0].prompt).toMatch(/^Explain this event from \{\{year\}\} for someone curious, in a few short paragraphs: \{\{text\}\} Say when you're unsure\./);
    expect(m.actions[0].prompt).toContain("change nothing outside the app without asking");
    const [report] = await testPlugin(DIR, { now: day(2026) });
    expect(report.attention.length).toBeGreaterThan(0);
  });

  it("keeps the panel inside the panel CSP: no inline style, no top-level await, a failed request caught", () => {
    const panel = fs.readFileSync(path.join(DIR, "panels", "events.tsx"), "utf8");
    expect(panel).not.toMatch(/<style|style=|dangerouslySetInnerHTML|innerHTML/);
    expect(panel).not.toMatch(/^await /m);
    expect(panel).toMatch(/requestAction\([^]*?\)\.catch\(/);
    // The page link is text: no anchor, nothing that opens a URL.
    expect(panel).not.toMatch(/<a[\s>]|window\.open/);
  });
});

describe("the events source on its fixture", () => {
  it("writes 25 records (the count default), raises one round-1901 item and sets the anniversary chip for 2026", async () => {
    const [report] = await testPlugin(DIR, { now: day(2026) });
    expect(report.ok, report.error).toBe(true);
    expect(report.writes.events.count).toBe(25);
    expect(report.attention).toEqual([{ key: "round-1901", severity: "info", title: "125 years ago today" }]);
    expect(report.chips).toEqual({ today: "125-year anniversary today" });
  });

  it("raises exactly one round item in every year from 2026 to 2050, on any date", async () => {
    for (let year = 2026; year <= 2050; year++) {
      const [report] = await testPlugin(DIR, { now: day(year, 1 + (year % 12), 1 + (year % 28)) });
      expect(report.ok, `${year}: ${report.error}`).toBe(true);
      const round = 1901 + ((year - 1901) % 25);
      expect(report.attention, String(year)).toEqual([{ key: `round-${round}`, severity: "info", title: `${year - round} years ago today` }]);
      expect(report.chips.today).toBe(`${year - round}-year anniversary today`);
    }
  }, 120_000);
});

describe("the events source on a ctx of its own", () => {
  // runSource starts each run with no stored data, so yesterday's records are seeded through a hand-made ctx here.
  it("resolves yesterday's round items before it replaces the list, so a failed write doesn't lose them", async () => {
    const resolved: string[] = [];
    const ctx = {
      settings: { get: async () => ({ count: 25 }) },
      fetch: async () => ({ url: "", status: 200, ok: true, headers: {}, text: () => '{"selected":[]}', json: () => ({ selected: [] }) }),
      data: {
        query: async () => ({ records: [{ year: 1001 }, { year: "x" }], total: 2 }),
        replaceAll: async () => {
          throw new Error("disk full");
        },
      },
      attention: { raise: async () => {}, resolve: async (key: string) => void resolved.push(key) },
      chip: { set: async () => {} },
    };
    await expect((backend.sources.events as (c: unknown) => Promise<void>)(ctx)).rejects.toThrow("disk full");
    expect(resolved).toEqual(["round-1001"]);
  });
});

describe("the demo lists it", () => {
  it("as bundled and off: the manifest takes plugins, and on is empty", async () => {
    const h = await loadHarness(path.join(DEMO, "harness.config.ts"));
    expect(pluginsAccepted(h)).toBe(true);
    expect(h.plugins).toMatchObject({ bundled: ["on-this-day"], local: true });
    expect(h.plugins?.on ?? []).toEqual([]);
  });
});
