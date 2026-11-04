import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { Rx } from "../src/guide";

const REPO = resolve(__dirname, "../../..");

/**
 * The Radix pieces screens may use (Radix + Impeccable spec §3, table "Guide piece → Becomes", plus the layout
 * and text primitives every composition needs). A piece enters this list only in the PR that adds it to DESIGN.md.
 */
const ALLOWED = [
  "AlertDialog", "Avatar", "Badge", "Box", "Button", "Callout", "Card", "Checkbox", "Code", "Dialog",
  "DropdownMenu", "Flex", "Grid", "Heading", "IconButton", "Popover", "Progress", "RadioGroup", "ScrollArea",
  "SegmentedControl", "Select", "Separator", "Switch", "Tabs", "Text", "TextArea", "TextField",
];

const RADIX_IMPORT = /(?:from\s+|import\s+|import\()\s*["']@radix-ui\/themes(?:\/[^"']*)?["']/;

function sources(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.split(/[\\/]/).includes("node_modules"))
    .map((f) => join(dir, f));
}

describe("Radix behind the guide barrel (Radix + Impeccable spec §3)", () => {
  it("the barrel exposes exactly the allowed Radix pieces", () => {
    expect(Object.keys(Rx).sort()).toEqual([...ALLOWED].sort());
  });

  it("only packages/ui/src/guide imports @radix-ui/themes", () => {
    const guide = join(REPO, "packages/ui/src/guide") + sep;
    const files = [...sources(join(REPO, "packages/ui/src")), ...sources(join(REPO, "packages/shell/src"))];
    const outside = files.filter((f) => !f.startsWith(guide) && RADIX_IMPORT.test(readFileSync(f, "utf8")));
    expect(outside.map((f) => f.slice(REPO.length + 1)), "import Radix pieces from packages/ui/src/guide (Rx), never from @radix-ui/themes").toEqual([]);
  });

  it("the import check sees the forms a screen could use", () => {
    for (const s of ['import { Button } from "@radix-ui/themes";', "import '@radix-ui/themes/styles.css';", 'const m = await import("@radix-ui/themes");'])
      expect(RADIX_IMPORT.test(s), s).toBe(true);
    expect(RADIX_IMPORT.test('import { Rx } from "./guide";')).toBe(false);
  });
});
