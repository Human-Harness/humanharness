import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, test } from "@playwright/test";
import { NOTICE_VERSION } from "@humanharness/engines";

// Real engines: no HH_TEST_ENGINES. Only the app's own userData and shared config are redirected.
const here = path.dirname(fileURLToPath(import.meta.url));
const shellDir = path.resolve(here, "../../shell");
const electronBinary = createRequire(path.join(shellDir, "package.json"))("electron") as string;
const OUT = process.env.HH_REAL_OUT ?? "";
const ENGINE = process.env.HH_REAL_ENGINE ?? "claude";
if (!OUT) throw new Error("HH_REAL_OUT is required: the folder for screenshots, answers and notes (e.g. HH_REAL_OUT=$HOME/hh-real-out).");
if (ENGINE !== "claude" && ENGINE !== "codex") throw new Error(`HH_REAL_ENGINE must be claude or codex (got ${ENGINE}).`);
const TIER = process.env.HH_REAL_TIER ?? "";
if (TIER && !["light", "standard", "deep"].includes(TIER)) throw new Error(`HH_REAL_TIER must be light, standard or deep (got ${TIER}).`);
/** What each level should run (resources spec §5.1): Claude's family by alias, the effort on both engines. */
const CLAUDE_FAMILY: Record<string, RegExp> = { light: /haiku/i, standard: /sonnet/i, deep: /opus/i };
const EFFORT: Record<string, string> = { light: "low", standard: "medium", deep: "high" };
fs.mkdirSync(OUT, { recursive: true });
const shot = (page: import("@playwright/test").Page, name: string) => page.screenshot({ path: path.join(OUT, `${ENGINE}-${name}.png`) });

test(`real ${ENGINE}: topic → blocks → next → note → next topic`, async () => {
  // The user's folder must sit outside the repo (so app-source stays a reference) and outside /private.
  const folder = path.join(os.homedir(), "Documents", `hh-real-test-${ENGINE}-${Date.now()}`);
  const userData = path.join(OUT, `${ENGINE}-userData`);
  const sharedDir = path.join(OUT, `${ENGINE}-shared`);
  for (const d of [folder, userData, sharedDir]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(userData, "config.json"),
    JSON.stringify({ language: "es", folder, engineId: ENGINE, ...(TIER ? { models: { tasks: { manifest: TIER } } } : {}) }),
  );
  const now = new Date().toISOString();
  const ready = { notice: { version: NOTICE_VERSION, acceptedAt: now }, verifiedAt: now };
  fs.writeFileSync(path.join(sharedDir, "engines.json"), JSON.stringify({ version: 1, engines: { [ENGINE]: ready } }));
  fs.writeFileSync(path.join(OUT, `${ENGINE}-folder.txt`), folder);

  const dropped = new Set(["ELECTRON_RENDERER_URL", "ELECTRON_RUN_AS_NODE"]);
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && !dropped.has(e[0])));
  const app = await electron.launch({ executablePath: electronBinary, args: [shellDir], env: { ...env, HH_TEST_USER_DATA: userData, HH_TEST_SHARED_DIR: sharedDir } });
  const page = await app.firstWindow();
  page.on("console", (m) => fs.appendFileSync(path.join(OUT, `${ENGINE}-console.log`), `${m.type()}: ${m.text()}\n`));
  try {
    await shot(page, "0-home");
    await page.getByRole("button", { name: "Iniciar Demo" }).click();
    await page.getByRole("region", { name: "¿Qué parte querés entender?" }).getByRole("button", { name: /El manifiesto/ }).click();
    // The answer ends with a choices block (a group of buttons).
    const choices = page.getByRole("main").getByRole("group").last();
    await expect(choices).toBeVisible();
    await expect(choices.getByRole("button").first()).toBeEnabled();
    await shot(page, "1-answer");
    fs.writeFileSync(path.join(OUT, `${ENGINE}-answer.txt`), await page.getByRole("main").innerText());
    const labels = await choices.getByRole("button").allInnerTexts();
    fs.writeFileSync(path.join(OUT, `${ENGINE}-choices.json`), JSON.stringify(labels, null, 2));
    if (TIER) {
      // The first usage line says which level ran and what the engine reported it ran on.
      const usage = path.join(folder, ".harness", "usage.jsonl");
      await expect.poll(() => fs.existsSync(usage)).toBe(true);
      const first = JSON.parse(fs.readFileSync(usage, "utf8").trim().split("\n")[0]) as Record<string, unknown>;
      fs.writeFileSync(path.join(OUT, `${ENGINE}-${TIER}-usage.json`), JSON.stringify(first, null, 2));
      expect(first).toMatchObject({ action: "manifest", tier: TIER, effort: EFFORT[TIER] });
      if (ENGINE === "claude") expect(String(first.reportedModel)).toMatch(CLAUDE_FAMILY[TIER]);
      else expect(first.reportedModel).toBeTruthy();
    }
    // Prefer an option that moves on along the path.
    const next = choices.getByRole("button", { name: /recorrido|siguiente|motores|seguir/i }).first();
    await ((await next.count()) ? next : choices.getByRole("button").last()).click();
    await expect.poll(() => fs.existsSync(path.join(folder, ".harness", "notes")) && fs.readdirSync(path.join(folder, ".harness", "notes")).length, { timeout: 300_000 }).toBeTruthy();
    await expect(page.getByRole("main").getByRole("group").last().getByRole("button").first()).toBeEnabled();
    await shot(page, "2-next");
    fs.writeFileSync(path.join(OUT, `${ENGINE}-answer2.txt`), await page.getByRole("main").innerText());
  } finally {
    await shot(page, "9-final").catch(() => {});
    await app.close();
    // Keep the folder's .harness for inspection: copy it out, then remove the folder from ~/Documents.
    if (fs.existsSync(path.join(folder, ".harness"))) fs.cpSync(path.join(folder, ".harness"), path.join(OUT, `${ENGINE}-harness`), { recursive: true });
    for (const f of ["AGENTS.md", "CLAUDE.md"]) if (fs.existsSync(path.join(folder, f))) fs.copyFileSync(path.join(folder, f), path.join(OUT, `${ENGINE}-${f}`));
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
