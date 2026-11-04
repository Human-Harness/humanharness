import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { closeAndClean, launch, makeSandbox } from "./helpers";
import { claudeScript } from "./scripts";

// Radix + Impeccable stage 2b: Settings › Engine and Models, built from the guide's Radix pieces. The screenshots go
// next to look.spec's (gitignored) for the critique round and the PR.
const here = path.dirname(fileURLToPath(import.meta.url));
const lookDir = path.resolve(here, "..", "test-results", "look");

async function openTab(page: Page, theme: "light" | "dark", tab: string) {
  await page.emulateMedia({ colorScheme: theme });
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("main", { name: "Settings" })).toBeVisible();
  await page.getByRole("tab", { name: tab }).click();
  await page.waitForTimeout(400);
}

const shot = (page: Page, name: string) => page.screenshot({ path: path.join(lookDir, `settings-${name}.png`), fullPage: true });

for (const theme of ["light", "dark"] as const) {
  test(`Settings › Engine with Radix, ${theme}`, async () => {
    test.setTimeout(120_000);
    const s = makeSandbox(`settings-engine-radix-${theme}`);
    const { app, page } = await launch(s, { claude: claudeScript });
    try {
      await page.getByRole("button", { name: "Start Demo" }).click();
      await openTab(page, theme, "Engine");
      await expect(page.getByText("In use").first()).toBeVisible();
      await shot(page, `engine-radix-${theme}`);
    } finally {
      await closeAndClean(app, s);
    }
  });

  test(`Settings › Models with Radix, ${theme}`, async () => {
    test.setTimeout(120_000);
    // One task off its recommendation and one custom, so both notes show.
    const s = makeSandbox(`settings-models-radix-${theme}`, { models: { tasks: { manifest: "deep", questions: { custom: { engine: "claude", effort: "high", cap: 400_000 } } } } });
    const { app, page } = await launch(s, { claude: claudeScript });
    try {
      await page.getByRole("button", { name: "Start Demo" }).click();
      await openTab(page, theme, "Models");
      await shot(page, `models-radix-${theme}`);
      await page.getByRole("button", { name: "Edit" }).first().click();
      await page.waitForTimeout(200);
      await shot(page, `models-radix-${theme}-custom`);
      await page.getByRole("radio", { name: "Levels" }).click();
      await page.waitForTimeout(300);
      await shot(page, `models-radix-${theme}-levels`);
    } finally {
      await closeAndClean(app, s);
    }
  });
}
