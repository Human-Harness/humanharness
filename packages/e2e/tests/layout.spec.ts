import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { closeAndClean, launchMock, makeSandbox } from "./helpers";

// Minimal core step 0b1: Home and the work screen are drawn from the layout. They must look as before: the screenshots
// go next to look.spec's (gitignored) to be compared with master's. LAYOUT_SHOT_TAG names a second set (master's run).
const here = path.dirname(fileURLToPath(import.meta.url));
const lookDir = path.resolve(here, "..", "test-results", "look");
const tag = process.env.LAYOUT_SHOT_TAG ? `-${process.env.LAYOUT_SHOT_TAG}` : "";
/** A tagged run may be of a build without the layout: it only takes the screenshots. */
const checkLayout = !tag;
const START = "Which part do you want to understand?";

async function look(page: Page, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme });
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.waitForTimeout(400);
}
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(lookDir, `layout-${name}${tag}.png`) });

for (const theme of ["light", "dark"] as const) {
  test(`the layout draws Home and the work screen, ${theme}`, async () => {
    test.setTimeout(120_000);
    const s = makeSandbox(`layout-${theme}`);
    const { app, page } = await launchMock(s);
    try {
      await look(page, theme);
      // Home: the layout's `home` child, the core's home/home block.
      await expect(page.getByRole("button", { name: "Start Demo" })).toBeEnabled();
      if (checkLayout) {
        await expect(page.locator('[data-layout-id="home"]')).toBeVisible();
        await expect(page.locator('[data-layout-id="work"]')).toHaveCount(0);
        await expect(page.getByText("This part isn't available yet")).toHaveCount(0);
      }
      await shot(page, `home-${theme}`);
      // The work screen: the layout's `work` child, the task block.
      await page.getByRole("button", { name: "Start Demo" }).click();
      await expect(page.getByRole("region", { name: START })).toBeVisible();
      if (checkLayout) {
        await expect(page.locator('[data-layout-id="work"]')).toBeVisible();
        await expect(page.locator('[data-layout-id="home"]')).toHaveCount(0);
      }
      await page.waitForTimeout(400);
      await shot(page, `work-${theme}`);
    } finally {
      await closeAndClean(app, s);
    }
  });
}
