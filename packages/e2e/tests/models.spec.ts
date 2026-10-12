import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { closeAndClean, launch, makeSandbox, profileFlags, readJsonl, sessionOf, usageFile } from "./helpers";
import { checkpointScript, claudeScript } from "./scripts";

type Run = { argv: string[]; prompt: string };
const START = "¿Qué parte querés entender?";
const readTasks = (folder: string) => JSON.parse(fs.readFileSync(path.join(folder, ".harness", "tasks.json"), "utf8"));
const MANIFEST_ANSWER = "El manifiesto declara todo el harness.";

test("a long task saves what matters before the engine compacts, then answers the follow-up", async () => {
  const s = makeSandbox("checkpoint");
  const { app, page } = await launch(s, { claude: checkpointScript });
  try {
    await page.getByRole("button", { name: "Iniciar Demo" }).click();
    await page.getByRole("region", { name: START }).getByRole("button", { name: /El manifiesto/ }).click();
    await expect(page.getByRole("main").getByText(MANIFEST_ANSWER)).toBeVisible();
    await expect(page.getByRole("meter", { name: "Contexto en uso" })).toHaveAttribute("aria-valuenow", "85");

    await page.getByRole("button", { name: "Profundizar en las acciones" }).click();
    await expect(page.getByRole("main").getByText("Las acciones traen su brief.")).toBeVisible();

    const runs = readJsonl<Run>(s.claudePrompts);
    expect(runs.map((r) => (r.prompt.startsWith("Checkpoint:") ? "checkpoint" : r.prompt.includes("# Topic: the manifest") ? "brief" : r.prompt))).toEqual([
      "brief",
      "checkpoint",
      "Contame más de las acciones.",
    ]);
    expect(sessionOf(runs[1].argv)).toBe(sessionOf(runs[0].argv));
    expect(fs.readFileSync(path.join(s.folder, ".harness", "notes", "manifest.md"), "utf8")).toContain('title: "El manifiesto"');
    // The checkpoint's own reply never reaches the chat.
    await expect(page.getByRole("main").getByText("Guardé lo importante.")).toHaveCount(0);
    await expect.poll(() => readJsonl<{ phase?: string; kind?: string }>(usageFile(s)).map((r) => r.kind ?? r.phase)).toEqual(["run", "checkpoint", "run"]);
    await expect.poll(() => readTasks(s.folder).current).toMatchObject({ status: "waiting", checkpointed: true, checkpointNote: true });
  } finally {
    await closeAndClean(app, s);
  }
});

test("a model the plan doesn't include falls back a level, and the task says so", async () => {
  const s = makeSandbox("fallback", { models: { tasks: { manifest: "deep" } } });
  const { app, page } = await launch(s, { claude: { ...claudeScript, failModels: ["opus"] } });
  try {
    await page.getByRole("button", { name: "Iniciar Demo" }).click();
    await page.getByRole("region", { name: START }).getByRole("button", { name: /El manifiesto/ }).click();
    await expect(page.getByRole("main").getByText(MANIFEST_ANSWER)).toBeVisible();
    await expect(page.getByText("Tu plan no incluye opus; usamos el nivel Estándar.")).toBeVisible();
    await expect(page.getByText(/no incluye el modelo elegido/)).toHaveCount(0);

    const runs = readJsonl<Run>(s.claudePrompts);
    expect(runs.map((r) => profileFlags(r.argv))).toEqual([
      ["opus", "high", "400000"],
      ["sonnet", "medium", "200000"],
    ]);
    expect(runs[1].prompt).toBe(runs[0].prompt);
    expect(sessionOf(runs[1].argv)).not.toBe(sessionOf(runs[0].argv));
    await expect
      .poll(() => readTasks(s.folder).current?.profile)
      .toEqual({ engine: "claude", tier: "standard", model: "sonnet", effort: "medium", cap: 200_000, fallbackFrom: "opus" });
  } finally {
    await closeAndClean(app, s);
  }
});

test("Settings › Modelos: a level picked for a topic applies to its next task", async () => {
  const s = makeSandbox("settings-models");
  const { app, page } = await launch(s, { claude: claudeScript });
  try {
    await page.getByRole("button", { name: "Iniciar Demo" }).click();
    await page.getByRole("button", { name: "Ajustes" }).click();
    await page.getByRole("tab", { name: "Modelos" }).click();
    await page.getByRole("region", { name: "Tareas" }).getByRole("group", { name: "El manifiesto" }).getByRole("button", { name: "Liviano" }).click();
    await expect(page.getByText("Cambiado · recomendado: Estándar")).toBeVisible();
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(s.userData, "config.json"), "utf8")).models).toEqual({ tasks: { manifest: "light" } });
    await page.getByRole("button", { name: "Listo" }).click();

    await page.getByRole("region", { name: START }).getByRole("button", { name: /El manifiesto/ }).click();
    await expect(page.getByRole("main").getByText(MANIFEST_ANSWER)).toBeVisible();
    expect(profileFlags(readJsonl<Run>(s.claudePrompts)[0].argv)).toEqual(["haiku", "low", "100000"]);
  } finally {
    await closeAndClean(app, s);
  }
});
