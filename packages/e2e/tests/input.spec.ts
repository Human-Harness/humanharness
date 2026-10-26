import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { closeAndClean, launch, makeSandbox, readJsonl, shellDir } from "./helpers";
import { quizScript } from "./input-scripts";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/input-harness");
const readTasks = (folder: string) => JSON.parse(fs.readFileSync(path.join(folder, ".harness", "tasks.json"), "utf8"));

test("the person answers an input block; the agent gets the line and the JSON, and marks the answer", async () => {
  // A full app build of the fixture before the app starts.
  test.setTimeout(300_000);
  const s = makeSandbox("input");
  // Inside out/ (git-ignored), so the build resolves the shell's dependencies like the default one.
  const outDir = path.join(shellDir, "out", "input");
  // electron-vite directly: `humanharness dev --build` would first run `check`, which a test fixture has no HARNESS.md for.
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: outDir };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });

  const { app, page } = await launch(s, { claude: quizScript }, path.join(outDir, "main", "index.js"));
  try {
    await page.getByRole("button", { name: "Iniciar Quiz" }).click();
    await page.getByRole("button", { name: /Practicar/ }).first().click();
    const question = page.getByRole("region", { name: "¿Quién comió más?" });
    await expect(question).toBeVisible();

    // Nothing written: the app refuses it, and the error sits next to the field.
    await question.getByRole("button", { name: "Me comprometo" }).click();
    await expect(question.getByRole("alert")).toContainText("Revisá los campos marcados.");
    await expect(question.getByLabel("¿Por qué? Con tus palabras")).toHaveAttribute("aria-invalid", "true");

    await question.getByRole("radio", { name: "Las dos igual" }).check();
    await question.getByLabel("¿Por qué? Con tus palabras").fill("Porque dos mitades son un entero");
    await question.getByRole("button", { name: "Me comprometo" }).click();

    const line = "Elegí: Las dos igual\n\n¿Por qué? Con tus palabras: Porque dos mitades son un entero";
    await expect(page.getByRole("main").getByText("Bien pensado.")).toBeVisible();
    await expect(question.getByText("Tu respuesta")).toBeVisible();
    await expect(page.locator("mark.hh-mark.ok")).toHaveText("dos mitades");

    // The agent got the readable line and the exact JSON.
    const prompts = readJsonl<{ prompt: string }>(s.claudePrompts).map((p) => p.prompt);
    const answer = prompts.find((p) => p.startsWith("[respuesta a commit_answer]"));
    expect(answer).toContain(line);
    const json = JSON.parse(/```json\n(.+)\n```$/.exec(answer!)![1]);
    expect(json).toMatchObject({ block: "commit_answer", value: { choice: "Las dos igual", why: "Porque dos mitades son un entero" } });
    expect(json.blockId).toMatch(/^[0-9a-f-]+:0:0$/);

    // tasks.json: nothing pending any more. The chat log: the answer on its block, and the person's line.
    await expect.poll(() => readTasks(s.folder).current?.status).toBe("waiting");
    expect(readTasks(s.folder).current).not.toHaveProperty("pendingInput");
    const chat = readJsonl<{ role: string; text: string; blocks?: { name: string; id?: string; input?: { value: unknown } }[] }>(
      path.join(s.folder, ".harness", "chats", "main.jsonl"),
    );
    const shown = chat.flatMap((e) => e.blocks ?? []).find((b) => b.name === "commit_answer");
    expect(shown).toMatchObject({ id: json.blockId, input: { value: json.value } });
    expect(chat.some((e) => e.role === "user" && e.text === line)).toBe(true);

    // AGENTS.md explains answers.
    expect(fs.readFileSync(path.join(s.folder, "AGENTS.md"), "utf8")).toContain("### Respuestas de bloques de entrada");
  } finally {
    await closeAndClean(app, s);
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
