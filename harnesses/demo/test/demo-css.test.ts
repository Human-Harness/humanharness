import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "../ui/demo.css"), "utf8");

it("uses only guide font sizes and weights (style guide §2, §15 harness blocks)", () => {
  for (const m of css.matchAll(/font-size:\s*(\d+)px/g)) expect([12, 13, 14, 15, 16, 20, 28]).toContain(Number(m[1]));
  for (const m of css.matchAll(/font-weight:\s*(\d+)/g)) expect([400, 500, 600]).toContain(Number(m[1]));
  expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
});
