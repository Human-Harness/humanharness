import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { closeAndClean, launchMock, makeFreshSandbox, makeSandbox } from "./helpers";

const START = "Which part do you want to understand?";
const TILES = "AI engines";

test("mock mode walks a demo topic from its recording, off script included, with no engine", async () => {
  const s = makeSandbox("mock");
  const { app, page } = await launchMock(s);
  try {
    await expect(page.getByText("Test mode (no AI)")).toBeVisible();
    await page.getByRole("button", { name: "Start Demo" }).click();
    await page.getByRole("region", { name: START }).getByRole("button", { name: /The manifest/ }).click();
    await expect(page.getByRole("main").getByText(/El manifiesto declara todo el harness/)).toBeVisible();
    await expect(page.getByRole("figure", { name: "Del manifiesto a la app" })).toBeVisible();

    // Off script: a typed follow-up isn't recorded, so the fallback answers and the choices come back.
    await page.getByPlaceholder("Ask about this topic…").fill("¿Y los permisos?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("main").getByText(/no está grabada en esta prueba/)).toBeVisible();

    // The choices come back under the fallback answer.
    await expect(page.getByRole("button", { name: "Profundizar en las acciones" })).toHaveCount(2);
    await page.getByRole("button", { name: "Profundizar en las acciones" }).last().click();
    await expect(page.getByRole("main").getByText(/Cada acción trae su brief/)).toBeVisible();

    await expect(page.getByRole("button", { name: "Seguir el recorrido →" })).toHaveCount(3);
    await page.getByRole("button", { name: "Seguir el recorrido →" }).last().click();
    await expect(page.getByRole("main").getByText(/Los motores se detectan en cada inicio/)).toBeVisible();
    const note = fs.readFileSync(path.join(s.folder, ".harness", "notes", "manifest.md"), "utf8");
    expect(note).toContain('title: "El manifiesto"');
    // The usage line says the test engine spends nothing (not that it doesn't report limits).
    await expect(page.getByText(/^Test mode: uses none of your plan\./)).toBeVisible();

    // Only the fake engine is offered.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "Engine" }).click();
    const tiles = page.getByRole("group", { name: TILES });
    await expect(tiles.getByRole("button", { name: /Simulated AI \(mock\)/ })).toBeVisible();
    await expect(tiles.getByRole("button", { name: /Claude/ })).toHaveCount(0);
    await expect(tiles.getByRole("button", { name: /Codex/ })).toHaveCount(0);
  } finally {
    await closeAndClean(app, s);
  }
});

test("a fresh mock app walks the setup flow, then starts the demo on the test engine and model", async () => {
  const s = makeFreshSandbox("mock-setup");
  const { app, page } = await launchMock(s);
  try {
    // Home says what is missing and offers the setup instead of the demo.
    await expect(page.getByRole("region", { name: "Two steps before you start" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start Demo" })).toHaveCount(0);
    await page.getByRole("button", { name: "Set up Demo" }).click();

    // 1. The folder: stay on this computer, so the folder is the sandbox's (synced places would leave it).
    await expect(page.getByRole("heading", { name: "Where should we keep your work?" })).toBeVisible();
    const local = page.getByRole("radio", { name: "Only on this computer" });
    if (await local.count()) await local.check();
    await expect(page.getByText(s.folder, { exact: true })).toBeVisible();
    await page.getByRole("contentinfo").getByRole("button", { name: "Next" }).click();

    // 2. The engine: only the test engine, ready with no notice to accept.
    const tiles = page.getByRole("group", { name: TILES });
    await expect(tiles.getByRole("button", { name: /Simulated AI \(mock\).*Connected/ })).toBeVisible();
    await expect(tiles.getByRole("button", { name: /Claude|Codex/ })).toHaveCount(0);
    const next = page.getByRole("button", { name: "Next" });
    await expect(next).toBeEnabled();
    await next.click();

    // 3. All set, then the demo.
    await expect(page.getByRole("heading", { name: "All set" })).toBeVisible();
    await expect(page.getByText("Simulated AI (mock) · Test model")).toBeVisible();
    await page.getByRole("button", { name: "Start Demo" }).click();
    await expect(page.getByRole("region", { name: START })).toBeVisible();
    const config = JSON.parse(fs.readFileSync(path.join(s.userData, "config.json"), "utf8"));
    expect(config).toMatchObject({ language: "en", folder: s.folder, engineId: "claude" });
    // Settings › Modelos shows the test model.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "Models" }).click();
    await page.getByRole("group", { name: "Models" }).getByRole("button", { name: "Levels" }).click();
    // Every level runs on the test model.
    const models = page.getByRole("tabpanel", { name: "Models" }).getByRole("combobox", { name: "Model" });
    await expect(models).toHaveCount(3);
    for (const model of await models.all()) await expect(model.locator("option:checked")).toHaveText("Test model");
  } finally {
    await closeAndClean(app, s);
  }
});
