import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const main = readFileSync(resolve(__dirname, "../src/renderer/main.tsx"), "utf8");

describe("bundled fonts (style guide §2 Type)", () => {
  it("loads DM Sans 400/500/600 and DM Mono 400, never 700", () => {
    for (const w of [400, 500, 600]) expect(main).toContain(`@fontsource/dm-sans/${w}.css`);
    expect(main).toContain("@fontsource/dm-mono/400.css");
    expect(main).not.toMatch(/\/700\.css/);
  });
});
