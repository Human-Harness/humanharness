import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkHarness } from "../src/check";
import { initHarness } from "../src/init";
import { CORE, replaceIn, tempRoot } from "./helpers";

const { root, cleanup } = tempRoot("hh-check-pre-");
afterAll(cleanup);
let n = 0;

/** A tool file: `returns` is a zod expression or nothing. */
const tool = (description: string, returns?: string) => `import { defineTool, z } from "@humanharness/cli/tool";

export default defineTool({
  description: ${JSON.stringify(description)},
  params: z.object({}),
  ${returns ? `returns: ${returns},\n  ` : ""}uses: { files: "read" },
  async run() {
    return [];
  },
});
`;

/** The template with two tools, `due-today` (returns as given) and `warmup-cards`, and `pre` on its action. */
async function fixture(pre: string | null, returns?: string): Promise<string> {
  const dir = path.join(root, `h${++n}`);
  await initHarness({ dir, core: CORE, install: false });
  replaceIn(dir, "harness.config.ts", "  actions: {\n", '  tools: { "due-today": "./tools/due-today.ts", "warmup-cards": "./tools/warmup-cards.ts" },\n  actions: {\n');
  if (pre) replaceIn(dir, "harness.config.ts", '      tier: "standard",\n', `      tier: "standard",\n      pre: ${pre},\n`);
  fs.mkdirSync(path.join(dir, "tools"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tools", "due-today.ts"), tool("Lists the cards due today, oldest first.", returns));
  fs.writeFileSync(path.join(dir, "tools", "warmup-cards.ts"), tool("Picks a few warm-up cards from the given ones."));
  return dir;
}
const PRE = '[{ tool: "due-today", as: "today" }, { tool: "warmup-cards", input: ["today"] }]';

describe("check: tool-steps (tools spec §3.3)", () => {
  it("a pre-step's input from a tool without returns is a tool-steps error on the manifest", async () => {
    const r = await checkHarness(await fixture(PRE));
    expect(r.findings.filter((f) => f.rule.startsWith("tool-"))).toEqual([
      { rule: "tool-steps", severity: "error", message: 'example: pre[1]: input "today": due-today declares no returns', file: "harness.config.ts" },
    ]);
  });

  it("an input from a tool that declares returns has no finding", async () => {
    const r = await checkHarness(await fixture(PRE, "z.array(z.string())"));
    expect(r.findings.filter((f) => f.rule.startsWith("tool-"))).toEqual([]);
  });

  it("D0: no tool-steps finding without pre", async () => {
    const r = await checkHarness(await fixture(null));
    expect(r.findings.some((f) => f.rule === "tool-steps")).toBe(false);
  });
});
