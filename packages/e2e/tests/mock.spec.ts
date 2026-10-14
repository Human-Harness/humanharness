import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { closeAndClean, launchMock, makeSandbox } from "./helpers";

const START = "¿Qué parte querés entender?";

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

    await page.getByRole("button", { name: "Profundizar en las acciones" }).last().click();
    await expect(page.getByRole("main").getByText(/Cada acción trae su brief/)).toBeVisible();

    await page.getByRole("button", { name: "Seguir el recorrido →" }).last().click();
    await expect(page.getByRole("main").getByText(/Los motores se detectan en cada inicio/)).toBeVisible();
    const note = fs.readFileSync(path.join(s.folder, ".harness", "notes", "manifest.md"), "utf8");
    expect(note).toContain('title: "El manifiesto"');

    // Only the fake engine is offered.
    await page.getByRole("button", { name: "Ajustes" }).click();
    await page.getByRole("tab", { name: "Motor" }).click();
    await expect(page.getByRole("button", { name: /Codex/ })).toHaveCount(0);
  } finally {
    await closeAndClean(app, s);
  }
});
