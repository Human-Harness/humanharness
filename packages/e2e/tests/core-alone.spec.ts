import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { answerGoBack, appHomeOf, closeAndClean, launch, makeSandbox } from "./helpers";
import { historyScript } from "./scripts";

// Core alone (minimal-core spec §8): the demo harness declares no mods, the two core mods that are on by default (Home,
// Sidekick) are switched off, and the person's layout places no mod block. The core still runs a task and undoes its
// turn, and nothing of a mod shows: no `.harness/mods/`, no mod section in AGENTS.md, no mod block or slot part.
// Home is the screen with the start buttons, so the task starts from ⌘K, which is the core's.

const MOD = process.platform === "darwin" ? "Meta" : "Control";
/** The demo harness, as the shell's default build ships it. */
const harnessId = "demo";
/** A valid layout with no mod block: the `home` child is empty, and the one block is the core's task view. */
const coreLayout = {
  type: "stack",
  children: [
    { type: "column", id: "home", children: [] },
    { type: "block", id: "work", content: { core: "task" } },
  ],
};

const modIds = ["home", "sidekick"];

/**
 * No mod's block or slot part is in the window. A block: any layout block but the core's `work`, the off or missing
 * notice, or a crashed part's alert. A slot part: only Sidekick fills the core's slots, and everything it draws is
 * named after it (its `hh-sk-` and `sidekick` classes, its buttons, tab, panel and rows).
 */
async function expectNoModUi(page: Page) {
  await expect(page.locator('[data-layout="block"]:not([data-layout-id="work"])')).toHaveCount(0);
  await expect(page.getByText(/^Mod .+ is off|This part of the app failed|This part is missing/)).toHaveCount(0);
  await expect(page.locator('[class*="hh-sk-"], [class*="sidekick"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Sidekick/ })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /Sidekick/ })).toHaveCount(0);
  await expect(page.getByText(/Sidekick/)).toHaveCount(0);
}

test("core alone: with no mods a task runs and its turn is undone, and nothing of a mod appears", async () => {
  const s = makeSandbox("core-alone", { mods: { on: Object.fromEntries(modIds.map((id) => [id, false])) } });
  fs.writeFileSync(path.join(s.folder, "plan.md"), "mi plan original\n");
  const home = appHomeOf(s, harnessId);
  fs.mkdirSync(path.join(home, "layouts"), { recursive: true });
  fs.writeFileSync(path.join(home, "layouts", "core.json"), JSON.stringify(coreLayout));
  fs.writeFileSync(path.join(home, "settings.json"), JSON.stringify({ layout: "core" }));
  const modsDir = path.join(s.folder, ".harness", "mods");
  const plan = () => fs.readFileSync(path.join(s.folder, "plan.md"), "utf8");
  const status = () => JSON.parse(fs.readFileSync(path.join(s.folder, ".harness", "tasks.json"), "utf8")).current?.status;
  const { app, page } = await launch(s, { claude: historyScript });
  try {
    // The layout is the one written here (a broken one would fall back to the app's, with Home's block).
    await expect(page.locator('[data-layout-id="home"][data-layout="column"]')).toHaveCount(1);
    const rows = await page.evaluate(async () => {
      const hh = (window as unknown as { hh: { mods: { view(): Promise<{ mods: { id: string; on: boolean }[] }> } } }).hh;
      return (await hh.mods.view()).mods.map((m) => ({ id: m.id, on: m.on }));
    });
    expect(rows.map((r) => r.id).sort()).toEqual(modIds);
    expect(rows.filter((r) => r.on)).toEqual([]);
    await expectNoModUi(page);

    await page.keyboard.press(`${MOD}+k`);
    const search = page.getByRole("dialog", { name: "Search" });
    await page.keyboard.type("The manifest");
    await search.getByRole("option", { name: /The manifest/ }).first().click();
    await expect(page.getByRole("main").getByText("Cambié tu plan.")).toBeVisible();
    // The text shows before the turn ends: wait until the task waits (its commit is made by then).
    await expect.poll(status).toBe("waiting");
    expect(plan()).toBe("cambiado por la IA\n");
    await expectNoModUi(page);

    await answerGoBack(app, "Go back");
    await page.getByRole("button", { name: "History", exact: true }).click();
    const history = page.getByRole("region", { name: "History", exact: true });
    await history.getByRole("button", { name: "Undo this task" }).click();
    await expect(history).toBeHidden();
    await expect.poll(plan).toBe("mi plan original\n");
    await expectNoModUi(page);

    // Settings, where a mod may add a tab and rows to Models and Usage. (Settings › Mods lists the mods, off: core's.)
    await page.getByRole("button", { name: "Settings" }).first().click();
    for (const tab of ["Models", "Usage"]) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByRole("tabpanel", { name: tab })).toBeVisible();
      await expectNoModUi(page);
    }

    expect(fs.existsSync(modsDir)).toBe(false);
    const agents = fs.readFileSync(path.join(s.folder, "AGENTS.md"), "utf8");
    expect(agents).toContain("## ");
    expect(agents).not.toMatch(/^#+ .*\bmods?\b/im);
    expect(agents).not.toMatch(/sidekick|\.harness\/mods|mod\.json|defineMod/i);
  } finally {
    await closeAndClean(app, s);
  }
});
