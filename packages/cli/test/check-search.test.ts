import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkHarness } from "../src/check";
import { initHarness } from "../src/init";
import { CORE, replaceIn, tempRoot } from "./helpers";

const { root, cleanup } = tempRoot("hh-check-search-");
afterAll(cleanup);
let n = 0;

const PEOPLE = `  data: { people: { scoped: false, key: "id", agent: "none", schema: z.object({ id: z.string(), name: z.string() }), search: { title: "name" } } },\n  actions: {\n`;

async function fixture(search = PEOPLE, view?: string): Promise<string> {
  const dir = path.join(root, `h${++n}`);
  await initHarness({ dir, core: CORE, install: false });
  replaceIn(dir, "harness.config.ts", "  actions: {\n", search);
  if (view !== undefined) fs.writeFileSync(path.join(dir, "ui", "People.tsx"), view);
  return dir;
}
const rules = async (dir: string) => (await checkHarness(dir)).findings.filter((f) => f.rule === "search-data" || f.rule === "schema");

describe("check: search-data (search spec D4, §7; plan deviation 8)", () => {
  it("warns when no ui file names a searchable collection", async () => {
    expect(await rules(await fixture())).toEqual([expect.objectContaining({ rule: "search-data", severity: "warning", message: expect.stringContaining('"people"') })]);
  });

  it("warns when a view names it but none opens its records", async () => {
    const found = await rules(await fixture(PEOPLE, 'export const name = "people";\n'));
    expect(found).toEqual([expect.objectContaining({ rule: "search-data", message: expect.stringContaining("onOpenRecord") })]);
  });

  it("is quiet when a view opens its records", async () => {
    expect(await rules(await fixture(PEOPLE, 'client.search.onOpenRecord("people", (key) => show(key));\n'))).toEqual([]);
  });

  it("a field the schema lacks is a schema error", async () => {
    const found = await rules(await fixture(PEOPLE.replace('title: "name"', 'title: "nope"')));
    expect(found.some((f) => f.rule === "schema" && f.message.includes('"nope" is not a field of the schema'))).toBe(true);
  });

  it("a t() key or a comment naming it does not count as showing it", async () => {
    const view = 't("people");\n// "people"\n/* client.search.onOpenRecord("people", (key) => show(key)); */\n';
    expect(await rules(await fixture(PEOPLE, view))).toEqual([expect.objectContaining({ rule: "search-data", message: expect.stringContaining("no file in ui/ shows it") })]);
  });

  it("a commented-out onOpenRecord does not count as opening it", async () => {
    const found = await rules(await fixture(PEOPLE, 'const kind = "people";\n// client.search.onOpenRecord("people", (key) => show(key));\n'));
    expect(found).toEqual([expect.objectContaining({ rule: "search-data", message: expect.stringContaining("onOpenRecord") })]);
  });

  it("a // inside a string is no comment", async () => {
    expect(await rules(await fixture(PEOPLE, 'const u = "http://x"; client.search.onOpenRecord("people", (key) => show(key, u));\n'))).toEqual([]);
  });

  it("a non-literal onOpenRecord opens every collection", async () => {
    const view = 'for (const kind of ["people"]) client.search.onOpenRecord(kind, (key) => show(kind, key));\n';
    expect(await rules(await fixture(PEOPLE, view))).toEqual([]);
  });

  it("reads the view extensions the ui build resolves (.js, .jsx, .mjs, .mts)", async () => {
    for (const ext of ["js", "jsx", "mjs", "mts"]) {
      const dir = await fixture();
      fs.writeFileSync(path.join(dir, "ui", `People.${ext}`), 'client.search.onOpenRecord("people", (key) => show(key));\n');
      expect(await rules(dir)).toEqual([]);
    }
  });

  it("skips node_modules and links under ui/", async () => {
    const dir = await fixture();
    const opens = 'client.search.onOpenRecord("people", (key) => show(key));\n';
    fs.mkdirSync(path.join(dir, "ui", "node_modules", "dep"), { recursive: true });
    fs.writeFileSync(path.join(dir, "ui", "node_modules", "dep", "index.ts"), opens);
    const outside = path.join(root, `outside${n}.tsx`);
    fs.writeFileSync(outside, opens);
    fs.symlinkSync(outside, path.join(dir, "ui", "People.tsx"));
    const shared = path.join(root, `shared${n}`);
    fs.mkdirSync(shared);
    fs.writeFileSync(path.join(shared, "People.tsx"), opens);
    fs.symlinkSync(shared, path.join(dir, "ui", "shared"));
    expect(await rules(dir)).toEqual([expect.objectContaining({ rule: "search-data", message: expect.stringContaining("shows it") })]);
  });

  it("says nothing about search when the ui path is invalid (the schema error says it)", async () => {
    const found = await rules(await fixture(`  ui: "../elsewhere",\n${PEOPLE}`));
    expect(found).toEqual([expect.objectContaining({ rule: "schema", message: expect.stringContaining("ui:") })]);
  });

  it("names the configured ui folder", async () => {
    const dir = await fixture(`  ui: "views",\n${PEOPLE}`);
    fs.mkdirSync(path.join(dir, "views"));
    const found = await rules(dir);
    expect(found).toEqual([expect.objectContaining({ rule: "search-data", message: expect.stringContaining("no file in views/ shows it") })]);
  });
});
