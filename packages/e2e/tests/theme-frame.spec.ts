import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { closeAndClean, launchMock, makeSandbox } from "./helpers";

// Radix + Impeccable stage 1: the Radix root wraps the app, follows the system's dark mode and changes nothing on
// screen. The screenshots go next to look.spec's (gitignored) for the before/after comparison in the PR.
const here = path.dirname(fileURLToPath(import.meta.url));
const lookDir = path.resolve(here, "..", "test-results", "look");

for (const theme of ["light", "dark"] as const) {
  test(`theme frame: one Radix root, no box, ${theme}`, async () => {
    const s = makeSandbox(`theme-frame-${theme}`);
    const { app, page } = await launchMock(s);
    try {
      await page.emulateMedia({ colorScheme: theme });
      const root = page.locator(".radix-themes.hh-theme");
      await expect(root).toHaveCount(1);
      await expect(root).toHaveClass(new RegExp(`(^|\\s)${theme}(\\s|$)`));
      const look = await root.evaluate((el) => {
        const own = getComputedStyle(el);
        const body = getComputedStyle(document.body);
        const child = getComputedStyle(el.firstElementChild!);
        const text = (c: CSSStyleDeclaration) => [
          c.fontFamily, c.fontSize, c.lineHeight, c.color, c.overflowWrap, (c as unknown as Record<string, string>).webkitFontSmoothing,
        ];
        return { display: own.display, child: text(child), body: text(body) };
      });
      expect(look.display).toBe("contents");
      expect(look.child).toEqual(look.body);
      expect(look.body[1]).toBe("14px");
      expect(look.body[0]).toContain("DM Sans");
      await page.screenshot({ path: path.join(lookDir, `theme-frame-${theme}.png`) });
    } finally {
      await closeAndClean(app, s);
    }
  });
}
