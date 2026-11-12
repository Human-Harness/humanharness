import fs from "node:fs";
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

// Minimal core step 0b1: Home is a core mod, on by default. Off, the layout keeps its place with "Mod Home is off" and the
// one way back on. The home folder's core layer holds its files and the default layout after a launch.
for (const theme of ["light", "dark"] as const) {
  test(`Home is a core mod: on by default, off shows its line and Turn on, ${theme}`, async () => {
    test.skip(!checkLayout, "a tagged run only takes the layout's screenshots");
    test.setTimeout(120_000);
    const s = makeSandbox(`layout-home-mod-${theme}`);
    const { app, page } = await launchMock(s);
    try {
      await look(page, theme);
      await expect(page.getByRole("button", { name: "Start Demo" })).toBeEnabled();
      const core = fs.readdirSync(s.userData).map((h) => path.join(s.userData, h, "app", "core"));
      expect(core.some((dir) => fs.existsSync(path.join(dir, "mods", "home", "mod.json")))).toBe(true);
      expect(core.some((dir) => fs.existsSync(path.join(dir, "layouts", "main.json")))).toBe(true);

      // Settings › Mods: Home, a core mod (no Local badge), on.
      await page.getByRole("button", { name: "Settings" }).click();
      await page.getByRole("tab", { name: "Mods" }).click();
      const tab = page.getByRole("tabpanel", { name: "Mods" });
      const home = tab.getByRole("switch", { name: "Home", exact: true });
      await expect(home).toBeChecked();
      await expect(tab.getByText("Local", { exact: true })).toHaveCount(0);
      await home.click();
      await expect(home).not.toBeChecked();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("main", { name: "Settings" })).toHaveCount(0);

      // Off: the home block says so, with Turn on; Start is gone with Home.
      const off = page.getByRole("status").filter({ hasText: "Mod Home is off" });
      await expect(off).toBeVisible();
      await expect(page.getByRole("button", { name: "Start Demo" })).toHaveCount(0);
      await page.waitForTimeout(400);
      await shot(page, `home-off-${theme}`);

      // Turn on brings Home back.
      await off.getByRole("button", { name: "Turn on" }).click();
      await expect(page.getByRole("button", { name: "Start Demo" })).toBeEnabled();
      await expect(page.getByText("Mod Home is off")).toHaveCount(0);
    } finally {
      await closeAndClean(app, s);
    }
  });
}
