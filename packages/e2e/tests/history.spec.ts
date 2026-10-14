import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { closeAndClean, launch, makeSandbox } from "./helpers";
import { historyScript } from "./scripts";

const START = "¿Qué parte querés entender?";
const readTasks = (folder: string) => JSON.parse(fs.readFileSync(path.join(folder, ".harness", "tasks.json"), "utf8"));
const plan = (folder: string) => fs.readFileSync(path.join(folder, "plan.md"), "utf8");

test("a turn edits a file; going back to before the task brings it back, and the panel shows the restore", async () => {
  const s = makeSandbox("history");
  fs.writeFileSync(path.join(s.folder, "plan.md"), "mi plan original\n");
  const { app, page } = await launch(s, { claude: historyScript });
  try {
    await page.getByRole("button", { name: "Iniciar Demo" }).click();
    await page.getByRole("region", { name: START }).getByRole("button", { name: /El manifiesto/ }).click();
    await expect(page.getByRole("main").getByText("Cambié tu plan.")).toBeVisible();
    // The text shows before the turn ends: wait until the task waits (its commit is made by then).
    await expect.poll(() => readTasks(s.folder).current?.status).toBe("waiting");
    expect(plan(s.folder)).toBe("cambiado por la IA\n");

    await page.getByRole("button", { name: "Historial", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "Historial" });
    await expect(panel.getByRole("button", { name: /El manifiesto.*1 archivo cambiado/ })).toHaveAttribute("aria-expanded", "true");
    await expect(panel.getByRole("list", { name: "Archivos cambiados" }).getByText("plan.md")).toBeVisible();
    await panel.getByRole("button", { name: "Volver a antes de esta tarea" }).click();
    await panel.getByRole("button", { name: "Sí, volver" }).click();
    await expect(panel).toBeHidden();
    await expect.poll(() => plan(s.folder)).toBe("mi plan original\n");

    // The restore carries no task: it shows under "Other changes", and the task's own row keeps what it changed.
    await page.getByRole("button", { name: "Historial", exact: true }).click();
    const again = page.getByRole("dialog", { name: "Historial" });
    await expect(again.getByRole("button", { name: /El manifiesto.*1 archivo cambiado/ })).toHaveAttribute("aria-expanded", "true");
    await again.getByRole("button", { name: /Otros cambios/ }).click();
    await expect(again.getByText("Volviste a antes de esta tarea")).toBeVisible();
  } finally {
    await closeAndClean(app, s);
  }
});
