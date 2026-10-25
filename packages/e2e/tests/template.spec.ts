import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { closeAndClean, launch, makeSandbox, shellDir } from "./helpers";
import { templateScript } from "./scripts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const cli = path.join(repo, "packages", "cli", "bin", "humanharness.js");

test("a harness made with init builds with dev, opens, and runs its example task", async () => {
  // Two CLI runs and a full app build before the app starts.
  test.setTimeout(300_000);
  const s = makeSandbox("template");
  const harnessDir = path.join(s.root, "my-harness");
  // Inside out/ (git-ignored), so the build resolves the shell's dependencies like the default one.
  const outDir = path.join(shellDir, "out", "template");
  execFileSync(process.execPath, [cli, "init", harnessDir, "--core", repo, "--skip-install"], { stdio: "inherit" });
  execFileSync(process.execPath, [cli, "dev", "--build", outDir], { cwd: harnessDir, stdio: "inherit" });

  const { app, page } = await launch(s, { claude: templateScript }, path.join(outDir, "main", "index.js"));
  try {
    await page.getByRole("button", { name: "Start my-harness" }).click();
    await page.getByRole("region", { name: "Where do we start?" }).getByRole("button", { name: /Example/ }).click();
    await expect(page.getByRole("main").getByText("Hola, este harness todavía se está armando.")).toBeVisible();
    await expect(page.getByRole("article", { name: "Idea" }).getByText("Una idea")).toBeVisible();
    await expect(page.getByRole("button", { name: "Profundizar" })).toBeVisible();
  } finally {
    await closeAndClean(app, s);
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
