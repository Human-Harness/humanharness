import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { ClaudeScript } from "@humanharness/fake-agent";
import { closeAndClean, launch, launchMock, makeSandbox, shellDir } from "./helpers";

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

test.describe("look: the Inbox board", () => {
  // The demo has no parallel tasks: the parallel fixture's own build, as parallel.spec builds it.
  const fixture = path.resolve(here, "../../fake-agent/fixtures/parallel-harness");
  const outDir = path.join(shellDir, "out", "look-parallel");
  /** `slow`: write-a works 5 s, so write-b can finish (and wait for the person) meanwhile. */
  const slow = (JSON.parse(fs.readFileSync(path.join(fixture, "fake-script.json"), "utf8")).scenarios as { slow: ClaudeScript }).slow;

  test.beforeAll(() => {
    // electron-vite directly: `humanharness dev --build` would first run `check`, which a test fixture has no HARNESS.md for.
    test.setTimeout(300_000);
    const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: outDir };
    delete env.ELECTRON_RUN_AS_NODE;
    execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
  });
  test.afterAll(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  for (const theme of ["light", "dark"] as const) {
    test(`look: the Inbox board in ${theme}`, async () => {
      const s = makeSandbox(`look-inbox-${theme}`);
      const { app, page } = await launch(s, { claude: slow }, path.join(outDir, "main", "index.js"));
      try {
        await page.setViewportSize({ width: 1100, height: 720 });
        await page.emulateMedia({ colorScheme: theme });
        await page.getByRole("button", { name: "Start Parallel" }).click();
        const topic = (label: string) => page.getByRole("region", { name: "Where do we start?" }).getByRole("button", { name: new RegExp(label) });
        // One task working, one waiting for the person.
        await topic("Write A").click();
        await expect(page.getByRole("main").locator('[data-role="user"]')).toHaveCount(1);
        await page.locator("header.hh-task-head").getByRole("button", { name: "New task" }).click();
        await topic("Write B").click();
        await expect(page.getByRole("main").getByText("Wrote b.")).toBeVisible();
        await page.getByRole("button", { name: /^Inbox, \d+ waiting$/ }).click();
        const board = page.getByRole("region", { name: "Inbox", exact: true });
        await expect(board.getByRole("region", { name: /^Waiting for you \d+$/ }).getByRole("button", { name: /^Write B/ })).toBeVisible();
        await expect(board.getByRole("region", { name: /^Working \d+$/ }).getByRole("button", { name: /^Write A/ })).toBeVisible();
        await page.screenshot({ path: path.join(lookDir, `inbox-${theme}.png`) });
      } finally {
        await closeAndClean(app, s);
      }
    });
  }
});
