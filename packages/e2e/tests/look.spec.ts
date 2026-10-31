import fs from "node:fs";
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
    // A first run leaves a task in History, so Home has something to pick up.
    const first = await launchMock(s);
    await first.page.getByRole("button", { name: "Start Demo" }).click();
    await first.page.getByRole("region", { name: START }).getByRole("button", { name: /The manifest/ }).click();
    await expect(first.page.getByRole("figure", { name: "Del manifiesto a la app" })).toBeVisible();
    // Following the path to its end saves the topic's note, which leaves a task in History.
    await first.page.getByPlaceholder("Ask about this topic…").fill("¿Y los permisos?");
    await first.page.getByRole("button", { name: "Send" }).click();
    await expect(first.page.getByRole("main").getByText(/no está grabada en esta prueba/)).toBeVisible();
    await expect(first.page.getByRole("button", { name: "Profundizar en las acciones" })).toHaveCount(2);
    await first.page.getByRole("button", { name: "Profundizar en las acciones" }).last().click();
    await expect(first.page.getByRole("main").getByText(/Cada acción trae su brief/)).toBeVisible();
    await expect(first.page.getByRole("button", { name: "Seguir el recorrido →" })).toHaveCount(3);
    await first.page.getByRole("button", { name: "Seguir el recorrido →" }).last().click();
    await expect(first.page.getByRole("main").getByText(/Los motores se detectan en cada inicio/)).toBeVisible();
    await expect.poll(() => fs.existsSync(path.join(s.folder, ".harness", "notes", "manifest.md"))).toBe(true);
    await first.page.waitForTimeout(1500);
    await first.app.close();
    const { app, page } = await launchMock(s);
    try {
      await page.setViewportSize({ width: 1100, height: 720 });
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.getByRole("button", { name: "Start Demo" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Pick up where you left" })).toBeVisible();
      await page.screenshot({ path: path.join(lookDir, `home-${theme}.png`) });
    } finally {
      await closeAndClean(app, s);
    }
  });
}
