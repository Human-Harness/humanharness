import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { closeAndClean, launch, launchMock, makeSandbox } from "./helpers";
import { claudeScript } from "./scripts";

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

// The Inbox (stage 4a) has its own screenshots: inbox-radix.spec.

for (const theme of ["light", "dark"] as const) {
  test(`look: Settings › Models and › Usage in ${theme}; the rail opens Settings and Done goes back`, async () => {
    const s = makeSandbox(`look-settings-${theme}`);
    // The scripted demo, as flow.spec runs it: one answered task leaves numbers in Usage.
    const { app, page } = await launch(s, { claude: claudeScript });
    try {
      await page.setViewportSize({ width: 1100, height: 720 });
      await page.emulateMedia({ colorScheme: theme });
      await page.getByRole("button", { name: "Start Demo" }).click();
      await page.getByRole("region", { name: START }).getByRole("button", { name: /The manifest/ }).click();
      await expect(page.getByRole("main").getByText("El manifiesto declara todo el harness.")).toBeVisible();
      // The next topic closes the manifest task, so Usage has a real row for it (as in flow.spec).
      await page.getByRole("radio", { name: "Seguir el recorrido →" }).click();
      const answer = page.getByRole("main").getByText("Los motores se detectan en cada inicio.");
      await expect(answer).toBeVisible();

      // Settings is a page opened from the top bar gear, not a dialog over the chat.
      await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
      const settings = page.getByRole("main", { name: "Settings" });
      await expect(settings).toBeVisible();
      await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);
      await expect(answer).toBeHidden();

      await settings.getByRole("tab", { name: "Models" }).click();
      await expect(settings.getByRole("tabpanel", { name: "Models" })).toBeVisible();
      await page.screenshot({ path: path.join(lookDir, `settings-models-${theme}.png`) });

      await settings.getByRole("tab", { name: "Usage" }).click();
      const usage = settings.getByRole("tabpanel", { name: "Usage" });
      await expect(usage.getByText("15% used")).toBeVisible();
      await expect(usage.getByRole("row", { name: /The manifest/ }).getByRole("cell")).toHaveText(["≈ 4% of 5 h", "about 25 times"]);
      await page.screenshot({ path: path.join(lookDir, `settings-usage-${theme}.png`) });

      // Done returns to the screen the person was on: the task's chat, as they left it.
      await page.getByRole("button", { name: /^Back to (?!recommended|the )/ }).click();
      await expect(settings).toHaveCount(0);
      await expect(answer).toBeVisible();
    } finally {
      await closeAndClean(app, s);
    }
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`look: Setup's engine step and the History drawer in ${theme}`, async () => {
    // The folder is saved, the engine isn't: the setup screen opens at the engine, with every (fake) engine offered.
    const s = makeSandbox(`look-setup-${theme}`, { engineId: undefined });
    const { app, page } = await launch(s, { claude: claudeScript });
    try {
      await page.setViewportSize({ width: 1100, height: 720 });
      await page.emulateMedia({ colorScheme: theme });
      await page.getByRole("button", { name: "Set up Demo" }).click();
      const steps = page.getByRole("list", { name: "Steps" });
      await expect(steps.getByText("Step 2 of 2")).toBeVisible();
      await expect(steps.getByText(s.folder, { exact: true })).toBeVisible();
      const claude = page.getByRole("radiogroup", { name: "AI engines" }).getByRole("radio", { name: /Claude.*Connected/ });
      await expect(claude).toHaveAttribute("aria-checked", "true");
      await expect(page.getByRole("heading", { name: "One last check" })).toBeVisible();
      await page.screenshot({ path: path.join(lookDir, `setup-${theme}.png`) });

      // On to the demo: the History drawer over the chat.
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await expect(page.getByRole("heading", { name: "All set" })).toBeVisible();
      await page.getByRole("button", { name: "Start Demo" }).click();
      await page.getByRole("region", { name: START }).getByRole("button", { name: /The manifest/ }).click();
      await expect(page.getByRole("main").getByText("El manifiesto declara todo el harness.")).toBeVisible();
      await page.getByRole("button", { name: "History", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "History" })).toBeVisible();
      await page.screenshot({ path: path.join(lookDir, `history-${theme}.png`) });
    } finally {
      await closeAndClean(app, s);
    }
  });
}
