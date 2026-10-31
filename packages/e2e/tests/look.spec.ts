import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { closeAndClean, launchMock, makeSandbox } from "./helpers";

// Screenshots of the refreshed screens, one run per theme (UI refresh spec §9). No pixel assertions: the
// reviewer compares them with the mockups by eye. They land in packages/e2e/test-results/look/ (gitignored).
const here = path.dirname(fileURLToPath(import.meta.url));
const lookDir = path.resolve(here, "..", "test-results", "look");
const START = "Which part do you want to understand?";

for (const theme of ["light", "dark"] as const) {
  test(`look: the demo's start view and chat in ${theme}`, async () => {
    const s = makeSandbox(`look-${theme}`);
    const { app, page } = await launchMock(s);
    try {
      await page.emulateMedia({ colorScheme: theme });
      await page.getByRole("button", { name: "Start Demo" }).click();
      const start = page.getByRole("region", { name: START });
      await expect(start).toBeVisible();
      await page.screenshot({ path: path.join(lookDir, `start-${theme}.png`) });

      await start.getByRole("button", { name: /The manifest/ }).click();
      await expect(page.getByRole("figure", { name: "Del manifiesto a la app" })).toBeVisible();
      await page.screenshot({ path: path.join(lookDir, `chat-${theme}.png`) });
      // The chat card keeps room to read at the default window: the side columns give way first.
      const card = await page.locator(".hh-conversation").boundingBox();
      expect(card!.width).toBeGreaterThanOrEqual(340);
    } finally {
      await closeAndClean(app, s);
    }
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`look: the demo's Home in ${theme}`, async () => {
    const s = makeSandbox(`look-home-${theme}`);
    const { app, page } = await launchMock(s);
    try {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.getByRole("button", { name: "Start Demo" })).toBeVisible();
      await page.screenshot({ path: path.join(lookDir, `home-${theme}.png`) });
    } finally {
      await closeAndClean(app, s);
    }
  });
}
