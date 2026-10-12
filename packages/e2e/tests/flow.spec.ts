import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { launch, makeSandbox, readJsonl, sessionOf } from "./helpers";
import { claudeScript, codexScript } from "./scripts";

type Run = { argv: string[]; prompt: string };
const START = "¿Qué parte querés entender?";

test("a topic answered with blocks, then next: the note is saved and the next topic starts from it", async () => {
  const s = makeSandbox("flow");
  const { app, page } = await launch(s, { claude: claudeScript });
  try {
    await page.getByRole("button", { name: "Iniciar Demo" }).click();
    await page.getByRole("region", { name: START }).getByRole("button", { name: /El manifiesto/ }).click();
    await expect(page.getByRole("main").getByText("El manifiesto declara todo el harness.")).toBeVisible();
    await expect(page.getByRole("figure", { name: "Del manifiesto a la app" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Abrir packages/harness-sdk/src/index.ts en el editor" })).toBeVisible();

    await page.getByRole("radio", { name: "Seguir el recorrido →" }).click();
    await expect(page.getByRole("main").getByText("Los motores se detectan en cada inicio.")).toBeVisible();

    const note = fs.readFileSync(path.join(s.folder, ".harness", "notes", "manifest.md"), "utf8");
    expect(note).toContain('title: "El manifiesto"');
    expect(note).toContain("- defineHarness valida el manifiesto");

    const [first, close, second] = readJsonl<Run>(s.claudePrompts);
    expect(first.prompt).toContain("# Topic: the manifest");
    expect(first.prompt).not.toContain("## What we already covered");
    expect(close.prompt).toContain("save_note");
    expect(close.argv).toContain("--resume");
    expect(sessionOf(close.argv)).toBe(sessionOf(first.argv));
    expect(second.prompt).toContain("# Topic: engines");
    expect(second.prompt).toContain(
      "- El manifiesto (manifest): defineHarness valida el manifiesto; Las acciones traen su brief → .harness/notes/manifest.md",
    );
    expect(second.argv).toContain("--session-id");
    expect(sessionOf(second.argv)).not.toBe(sessionOf(first.argv));

    const tasks = JSON.parse(fs.readFileSync(path.join(s.folder, ".harness", "tasks.json"), "utf8"));
    expect(tasks.actions).toEqual({ manifest: "done" });
    expect(readJsonl<{ phase?: string }>(path.join(s.folder, ".harness", "usage.jsonl")).map((r) => r.phase)).toEqual(["run", "close", "run"]);
    await expect(page.getByRole("list", { name: "Lo que ya quedó claro" }).getByRole("button", { name: "El manifiesto" })).toBeVisible();
  } finally {
    await app.close();
  }
});

test("changing the engine keeps the notes, and the first task on the new engine starts from them", async () => {
  const s = makeSandbox("switch");
  const { app, page } = await launch(s, { claude: claudeScript, codex: codexScript });
  try {
    await page.getByRole("button", { name: "Iniciar Demo" }).click();
    await page.getByRole("region", { name: START }).getByRole("button", { name: /El manifiesto/ }).click();
    await expect(page.getByRole("main").getByText("El manifiesto declara todo el harness.")).toBeVisible();
    await page.getByRole("radio", { name: "Seguir el recorrido →" }).click();
    await expect(page.getByRole("main").getByText("Los motores se detectan en cada inicio.")).toBeVisible();

    await page.getByRole("button", { name: "Ajustes" }).click();
    await page.getByRole("tab", { name: "Motor" }).click();
    await page.getByRole("button", { name: /Codex/ }).first().click();
    await page.getByRole("button", { name: "Usar Codex" }).click();
    await page.getByRole("button", { name: "Listo" }).click();

    await expect(page.getByRole("main").getByText(/Ahora usás Codex/)).toBeVisible();
    await expect(page.getByRole("list", { name: "Lo que ya quedó claro" }).getByRole("button", { name: "El manifiesto" })).toBeVisible();
    expect(fs.existsSync(path.join(s.folder, ".harness", "notes", "manifest.md"))).toBe(true);
    const tasks = JSON.parse(fs.readFileSync(path.join(s.folder, ".harness", "tasks.json"), "utf8"));
    expect(tasks).toMatchObject({ current: null, actions: { manifest: "done", engines: "unfinished" } });

    await page.getByPlaceholder("O preguntá algo…").fill("¿Dónde se guarda la conversación?");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByRole("main").getByText("Se guarda en .harness/chats.")).toBeVisible();
    const prompt = readJsonl<{ method: string; params: { prompt: { text: string }[] } }>(s.acpLog).find((l) => l.method === "session/prompt");
    expect(prompt?.params.prompt[0].text).toContain("## Question\n¿Dónde se guarda la conversación?");
    expect(prompt?.params.prompt[0].text).toContain(
      "- El manifiesto (manifest): defineHarness valida el manifiesto; Las acciones traen su brief → .harness/notes/manifest.md",
    );
  } finally {
    await app.close();
  }
});
