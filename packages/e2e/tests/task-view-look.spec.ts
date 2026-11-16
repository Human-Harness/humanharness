import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { type ClaudeScript, claudeTextLines } from "@humanharness/fake-agent";
import { closeAndClean, launch, makeSandbox } from "./helpers";
import { claudeScript } from "./scripts";

// Task view one column, T13: the six task screens in both themes at 1100×720 and 900×600 (24 PNGs). No pixel
// assertions: the Impeccable rounds read them against DESIGN.md. They land in test-results/look/task-view/ (gitignored).
const here = path.dirname(fileURLToPath(import.meta.url));
const lookDir = path.resolve(here, "..", "test-results", "look", "task-view");
const START = "Which part do you want to understand?";

const result = { line: { type: "result", subtype: "success", is_error: false, result: "", session_id: "fake-session" } };
const LONG = [
  "## Cómo se arma el manifiesto",
  "El manifiesto es un solo archivo, `harness.config.ts`. `defineHarness` lo valida al arrancar y la app se construye a partir de él.",
  "### Qué declara",
  "- Las **acciones** que el harness ofrece, cada una con su brief.",
  "- Los **motores** que acepta y el nivel de modelo de cada proceso.",
  "- Las **notas** que guarda al cerrar un tema.",
  "### Por qué un solo archivo",
  "Un harness se instala como una app. Si todo lo que hace está en un lugar, se puede revisar de una vez y cambiar sin buscar en el código.",
  ...Array.from({ length: 8 }, (_, i) => `Detalle ${i + 1}: cada acción se valida contra su esquema antes de que la app la muestre, así un error aparece al arrancar y no en medio de una tarea.`),
].join("\n\n");

const script: ClaudeScript = {
  steps: claudeScript.steps,
  turns: [
    ...claudeScript.turns!,
    { match: "largo", steps: [...claudeTextLines(LONG), result] },
    {
      // A turn that reads a file, writes a first line and then waits: the working line and Stop are on screen.
      match: "lento",
      steps: [
        { line: { type: "system", subtype: "init", session_id: "fake-session" } },
        { line: { type: "assistant", message: { content: [{ type: "tool_use", id: "r1", name: "Read", input: { file_path: "harness.config.ts" } }] } } },
        ...claudeTextLines("Estoy leyendo el manifiesto para responderte.").slice(1, 3),
        { sleep: 30_000 },
        result,
      ],
    },
  ],
};

const SIZES = [
  { width: 1100, height: 720 },
  { width: 900, height: 600 },
] as const;

const box = (page: Page) => page.locator("form.hh-composer textarea");

for (const theme of ["light", "dark"] as const) {
  for (const size of SIZES) {
    const tag = `${theme}-${size.width}x${size.height}`;
    test(`task view look: the six task screens in ${theme} at ${size.width}×${size.height}`, async () => {
      test.setTimeout(180_000);
      const s = makeSandbox(`task-view-look-${tag}`);
      const notes = path.join(s.folder, ".harness", "notes");
      fs.mkdirSync(notes, { recursive: true });
      fs.writeFileSync(
        path.join(notes, "manifest.md"),
        "---\ntitle: Manifest basics\ndate: 2026-10-28\naction: manifest\n---\n## Summary\n- defineHarness validates it.\n- Each action brings its brief.\n",
      );
      const { app, page } = await launch(s, { claude: script });
      const shot = (name: string) => page.screenshot({ path: path.join(lookDir, `${name}-${tag}.png`) });
      try {
        await page.setViewportSize(size);
        await page.emulateMedia({ colorScheme: theme });
        await page.getByRole("button", { name: "Start Demo" }).click();

        // 1. Empty task: the start view, nothing asked yet.
        const start = page.getByRole("region", { name: START });
        await expect(start).toBeVisible();
        await expect(box(page)).toBeVisible();
        await shot("empty");

        await start.getByRole("button", { name: /The manifest/ }).click();
        await expect(page.getByRole("main").getByText("El manifiesto declara todo el harness.")).toBeVisible();

        // 2. A long answer, read from its start.
        await box(page).fill("Contame largo cómo se arma");
        await box(page).press("Enter");
        const conversation = page.getByRole("region", { name: "Conversation" });
        await expect(conversation.getByText(/Detalle 8:/)).toBeVisible();
        await expect(page.locator(".hh-working-line")).toHaveCount(0);
        await conversation.getByRole("heading", { name: "Cómo se arma el manifiesto" }).scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await shot("long-answer");

        // 3. The path overlay open over the column.
        await page.getByRole("button", { name: /^Path · \d+ \/ \d+$/ }).click();
        await expect(page.getByRole("complementary", { name: "Path" })).toBeVisible();
        await page.waitForTimeout(300);
        await shot("path-open");
        await page.keyboard.press("Escape");
        await expect(page.getByRole("complementary", { name: "Path" })).toHaveCount(0);

        // 4. The switcher open.
        await page.locator(".hh-shell header.hh-topbar").getByRole("button", { name: "The manifest" }).click();
        await expect(page.getByRole("menu")).toBeVisible();
        await page.waitForTimeout(300);
        await shot("switcher-open");
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toHaveCount(0);

        // 5. The task's Notes page, from the rail's TASK group.
        await page.getByRole("navigation", { name: "App" }).getByRole("button", { name: /^Notes/ }).click();
        await expect(page.getByRole("button", { name: /Manifest basics/ })).toBeVisible();
        await shot("notes");
        await page.getByRole("navigation", { name: "App" }).getByRole("button", { name: "Tasks" }).click();
        await expect(conversation).toBeVisible();

        // 6. A turn streaming: one working line with its step and Stop. Last, because Stop ends the demo's topic.
        await box(page).fill("Algo lento");
        await box(page).press("Enter");
        await expect(page.locator(".hh-working-line").getByRole("status")).toHaveText(/^Working · /);
        await expect(conversation.getByText("Estoy leyendo el manifiesto para responderte.")).toBeVisible();
        await shot("streaming");
      } finally {
        await closeAndClean(app, s);
      }
    });
  }
}
