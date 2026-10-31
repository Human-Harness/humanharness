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
});
