import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { closeAndClean, launchMock, makeSandbox } from "./helpers";

const START = "Which part do you want to understand?";
const PANEL = "What the AI takes into account";

test("the context panel: what the task loaded and read, Add now, a pin and an exclusion for the next task", async () => {
  const s = makeSandbox("context");
  fs.writeFileSync(path.join(s.folder, "conventions.md"), "# Conventions\n\nWe write in English.\n");
  const { app, page } = await launchMock(s);
  try {
    await page.getByRole("button", { name: "Start Demo" }).click();
    await page.getByRole("region", { name: START }).getByRole("button", { name: /The manifest/ }).click();
    await expect(page.getByRole("main").getByText(/El manifiesto declara todo el harness/)).toBeVisible();

    // The meter opens the panel: the start and the recorded read.
    await page.getByRole("button", { name: PANEL }).click();
    const panel = page.getByRole("region", { name: PANEL });
    const start = panel.getByRole("region", { name: "At the start" });
    await expect(start.getByText("What the task is about")).toBeVisible();
    await expect(start.getByText(/^Total: approx\. [\d,]+ tokens$/)).toBeVisible();
    await expect(start.getByText(/^First turn: [\d,]+ tokens \(real\)$/)).toBeVisible();
    await expect(panel.getByRole("region", { name: "During the task" }).getByText("README.md")).toBeVisible();

    // Add now: a picked file goes to this task; its line shows in the chat and the read in the panel.
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, path.join(s.folder, "conventions.md"));
    await panel.getByRole("button", { name: "Add…" }).click();
    await panel.getByRole("button", { name: "Choose a file…" }).click();
    await panel.getByRole("button", { name: "For this task" }).click();
    await expect(page.getByRole("main").getByText("Take conventions.md into account")).toBeVisible();
    await expect(page.getByRole("main").getByText("I read conventions.md and will take it into account.")).toBeVisible();
    await expect(panel.getByRole("region", { name: "During the task" }).getByText("conventions.md")).toBeVisible();
    // The mock's reply reports the recorded turn's usage: no compaction, so nothing reads as summarized.
    await expect(panel.getByText("may be summarized")).toHaveCount(0);
    await expect(panel.getByText(/The conversation was summarized/)).toHaveCount(0);

    // Pin it: one commit, the person's file.
    await panel.getByRole("region", { name: "During the task" }).getByRole("button", { name: "Pin conventions.md" }).click();
    await expect(panel.getByRole("region", { name: "Pinned" }).getByText("conventions.md")).toBeVisible();
    const pins = JSON.parse(fs.readFileSync(path.join(s.folder, ".harness", "context", "main.json"), "utf8"));
    expect(pins.pinned.map((p: { path: string }) => p.path)).toEqual(["conventions.md"]);

    // Finish the task as flow.spec.ts does (the choices came back under the Add now reply); its note is listed.
    await panel.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Seguir el recorrido →" }).last().click();
    await expect(page.getByRole("list", { name: "What's clear so far" }).getByRole("button", { name: "El manifiesto" })).toBeVisible();

    // The walk opens the next topic, which starts with the pin and the notes index; exclude the note.
    await expect(page.getByRole("main").getByText(/Los motores se detectan en cada inicio/)).toBeVisible();
    await page.getByRole("button", { name: PANEL }).click();
    const next = page.getByRole("region", { name: PANEL }).getByRole("region", { name: "At the start" });
    await expect(next.getByText("Pinned · conventions.md")).toBeVisible();
    await next.getByRole("button", { name: "Exclude El manifiesto" }).click();
    await expect(next.getByText("Applies from the next task")).toBeVisible();
    const excluded = JSON.parse(fs.readFileSync(path.join(s.folder, ".harness", "context", "main.json"), "utf8"));
    expect(excluded.excluded.map((e: { note: string }) => e.note)).toEqual([".harness/notes/manifest.md"]);

    // tasks.json never holds an absolute path: reads are folder-relative.
    const tasks = JSON.parse(fs.readFileSync(path.join(s.folder, ".harness", "tasks.json"), "utf8"));
    expect(JSON.stringify(tasks)).not.toContain(s.folder);
    // Nor under the folder's real path (macOS's /var → /private/var), the spelling engines report.
    expect(JSON.stringify(tasks)).not.toContain(fs.realpathSync(s.folder));
  } finally {
    await closeAndClean(app, s);
  }
});

test("D0: a task without pins or exclusions writes no context file", async () => {
  const s = makeSandbox("context-d0");
  const { app, page } = await launchMock(s);
  try {
    await page.getByRole("button", { name: "Start Demo" }).click();
    await page.getByRole("region", { name: START }).getByRole("button", { name: /The manifest/ }).click();
    await expect(page.getByRole("main").getByText(/El manifiesto declara todo el harness/)).toBeVisible();
    expect(fs.existsSync(path.join(s.folder, ".harness", "context"))).toBe(false);

    // Finished, with its note written and committed: still no context file.
    await page.getByRole("button", { name: "Seguir el recorrido →" }).last().click();
    await expect(page.getByRole("list", { name: "What's clear so far" }).getByRole("button", { name: "El manifiesto" })).toBeVisible();
    expect(fs.existsSync(path.join(s.folder, ".harness", "context"))).toBe(false);
  } finally {
    await closeAndClean(app, s);
  }
});
