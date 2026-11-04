import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { closeAndClean, launch, launchMock, makeSandbox } from "./helpers";
import { claudeScript } from "./scripts";

// Radix + Impeccable stage 3a: Inicio built from the guide's Radix pieces. The screenshots go next to look.spec's
// (gitignored) for the critique round and the PR.
const here = path.dirname(fileURLToPath(import.meta.url));
const lookDir = path.resolve(here, "..", "test-results", "look");
const START = "Which part do you want to understand?";

async function look(page: Page, theme: "light" | "dark", width = 1100) {
  await page.emulateMedia({ colorScheme: theme });
  await page.setViewportSize({ width, height: 800 });
  await page.waitForTimeout(400);
}
const shot = (page: Page, name: string) =>
  page.screenshot({
    path: path.join(lookDir, `home-radix-${name}.png`),
    fullPage: true,
  });

for (const theme of ["light", "dark"] as const) {
  test(`Inicio ready, with tasks to pick up, ${theme}`, async () => {
    test.setTimeout(180_000);
    const s = makeSandbox(`home-radix-ready-${theme}`);
    // A first run leaves a task in History, so Inicio has something to pick up (as look.spec does).
    const first = await launchMock(s);
    await first.page.getByRole("button", { name: "Start Demo" }).click();
    await first.page
      .getByRole("region", { name: START })
      .getByRole("button", { name: /The manifest/ })
      .click();
    await expect(first.page.getByRole("figure", { name: "Del manifiesto a la app" })).toBeVisible();
    await first.page.getByPlaceholder("Ask about this topic…").fill("¿Y los permisos?");
    await first.page.getByRole("button", { name: "Send" }).click();
    await expect(first.page.getByRole("main").getByText(/no está grabada en esta prueba/)).toBeVisible();
    await expect(first.page.getByRole("radio", { name: "Profundizar en las acciones" })).toHaveCount(2);
    await first.page.getByRole("radio", { name: "Profundizar en las acciones" }).last().click();
    await expect(first.page.getByRole("main").getByText(/Cada acción trae su brief/)).toBeVisible();
    await expect(first.page.getByRole("radio", { name: "Seguir el recorrido →" })).toHaveCount(3);
    await first.page.getByRole("radio", { name: "Seguir el recorrido →" }).last().click();
    await expect(first.page.getByRole("main").getByText(/Los motores se detectan en cada inicio/)).toBeVisible();
    await expect.poll(() => fs.existsSync(path.join(s.folder, ".harness", "notes", "manifest.md"))).toBe(true);
    await first.page.waitForTimeout(1500);
    await first.app.close();
    const { app, page } = await launchMock(s);
    try {
      await look(page, theme);
      await expect(page.getByRole("button", { name: "Start Demo" })).toBeEnabled();
      await expect(page.getByRole("heading", { name: "Pick up where you left" })).toBeVisible();
      await shot(page, `ready-${theme}`);
      // Narrow window: one column, nothing scrolls sideways.
      await look(page, theme, 560);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shot(page, `ready-${theme}-narrow`);
    } finally {
      await closeAndClean(app, s);
    }
  });

  test(`Inicio not set up, ${theme}`, async () => {
    test.setTimeout(120_000);
    const s = makeSandbox(`home-radix-setup-${theme}`, { engineId: "" });
    const { app, page } = await launch(s, { claude: claudeScript });
    try {
      await look(page, theme);
      await expect(page.getByRole("button", { name: "Set up Demo" })).toBeVisible();
      await shot(page, `setup-${theme}`);
    } finally {
      await closeAndClean(app, s);
    }
  });

  test(`Inicio with the backup notice, ${theme}`, async () => {
    test.setTimeout(120_000);
    // A folder outside ~/Documents (which may be synced) is only on this computer, so the notice shows.
    const local = fs.mkdtempSync(path.join(os.tmpdir(), "hh-home-backup-"));
    const s = makeSandbox(`home-radix-backup-${theme}`, { folder: local });
    const { app, page } = await launch(s, { claude: claudeScript });
    try {
      await look(page, theme);
      await expect(page.getByRole("region", { name: "Backup" })).toBeVisible();
      await shot(page, `backup-${theme}`);
    } finally {
      await closeAndClean(app, s);
      fs.rmSync(local, { recursive: true, force: true });
    }
  });

  test(`Inicio with the language offer, ${theme}`, async () => {
    test.setTimeout(120_000);
    const s = makeSandbox(`home-radix-lang-${theme}`, {
      languageOffered: false,
      backupDismissed: true,
    });
    const { app, page } = await launch(s, { claude: claudeScript });
    try {
      await look(page, theme);
      await expect(page.getByRole("region", { name: "Use Demo in another language?" })).toBeVisible();
      await shot(page, `lang-${theme}`);
    } finally {
      await closeAndClean(app, s);
    }
  });
}
