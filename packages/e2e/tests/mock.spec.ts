import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { closeAndClean, launchMock, makeFreshSandbox, makeSandbox } from "./helpers";

const START = "¿Qué parte querés entender?";
const TILES = "Motores de IA";

test("mock mode walks a demo topic from its recording, off script included, with no engine", async () => {
  const s = makeSandbox("mock");
  const { app, page } = await launchMock(s);
  try {
    await expect(page.getByText("Modo prueba (sin IA)")).toBeVisible();
    await page.getByRole("button", { name: "Iniciar Demo" }).click();
    await page.getByRole("region", { name: START }).getByRole("button", { name: /El manifiesto/ }).click();
    await expect(page.getByRole("main").getByText(/El manifiesto declara todo el harness/)).toBeVisible();
    await expect(page.getByRole("figure", { name: "Del manifiesto a la app" })).toBeVisible();

    // Off script: a typed follow-up isn't recorded, so the fallback answers and the choices come back.
    await page.getByPlaceholder("Preguntá sobre este tema…").fill("¿Y los permisos?");
    await page.getByRole("button", { name: "Enviar" }).click();
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

    // Only the fake engine is offered.
    await page.getByRole("button", { name: "Ajustes" }).click();
    await page.getByRole("tab", { name: "Motor" }).click();
    const tiles = page.getByRole("group", { name: TILES });
    await expect(tiles.getByRole("button", { name: /Motor de prueba/ })).toBeVisible();
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
    await expect(page.getByRole("region", { name: "Antes de empezar, dos pasos" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Iniciar Demo" })).toHaveCount(0);
    await page.getByRole("button", { name: "Configurar Demo" }).click();

    // 1. The folder: stay on this computer, so the folder is the sandbox's (synced places would leave it).
    await expect(page.getByRole("heading", { name: "¿Dónde guardamos tu trabajo?" })).toBeVisible();
    const local = page.getByRole("radio", { name: "Solo en esta compu" });
    if (await local.count()) await local.check();
    await expect(page.getByText(s.folder, { exact: true })).toBeVisible();
    await page.getByRole("contentinfo").getByRole("button", { name: "Siguiente" }).click();

    // 2. The engine: only the test engine, ready with no notice to accept.
    const tiles = page.getByRole("group", { name: TILES });
    await expect(tiles.getByRole("button", { name: /Motor de prueba.*Conectado/ })).toBeVisible();
    await expect(tiles.getByRole("button", { name: /Claude|Codex/ })).toHaveCount(0);
    const next = page.getByRole("button", { name: "Siguiente" });
    await expect(next).toBeEnabled();
    await next.click();

    // 3. All set, then the demo.
    await expect(page.getByRole("heading", { name: "Todo listo" })).toBeVisible();
    await expect(page.getByText("Motor de prueba · Modelo de prueba")).toBeVisible();
    await page.getByRole("button", { name: "Iniciar Demo" }).click();
    await expect(page.getByRole("region", { name: START })).toBeVisible();
    const config = JSON.parse(fs.readFileSync(path.join(s.userData, "config.json"), "utf8"));
    expect(config).toMatchObject({ language: "es", folder: s.folder, engineId: "claude" });
    // Settings › Modelos shows the test model.
    await page.getByRole("button", { name: "Ajustes" }).click();
    await page.getByRole("tab", { name: "Modelos" }).click();
    await page.getByRole("group", { name: "Modelos" }).getByRole("button", { name: "Niveles" }).click();
    // Every level runs on the test model.
    const models = page.getByRole("tabpanel", { name: "Modelos" }).getByRole("combobox", { name: "Modelo" });
    await expect(models).toHaveCount(3);
    for (const model of await models.all()) await expect(model.locator("option:checked")).toHaveText("Modelo de prueba");
  } finally {
    await closeAndClean(app, s);
  }
});
