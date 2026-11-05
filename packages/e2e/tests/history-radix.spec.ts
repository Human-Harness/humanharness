import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import type { ClaudeScript } from "@humanharness/fake-agent";
import { closeAndClean, launch, makeSandbox } from "./helpers";
import { historyScript } from "./scripts";

// Radix + Impeccable stage 4b1: History as a secondary page and a file's timeline as a split view (DESIGN.md
// "Secondary pages", "Split views"). The screenshots go next to look.spec's (gitignored) for the critique round and the PR.
const here = path.dirname(fileURLToPath(import.meta.url));
const lookDir = path.resolve(here, "..", "test-results", "look");
const START = "Which part do you want to understand?";
const readTasks = (folder: string) => JSON.parse(fs.readFileSync(path.join(folder, ".harness", "tasks.json"), "utf8"));
/** History's turn, which also changes a JSON file: a file the reader can't open, so its timeline opens in the split view. */
const turn = historyScript.turns![0];
const script: ClaudeScript = {
  ...historyScript,
  turns: [{ ...turn, steps: [{ write: { path: "data.json", content: '{ "plan": "cambiado" }\n' } }, ...turn.steps] }],
};
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(lookDir, `${name}.png`), fullPage: true });

for (const theme of ["light", "dark"] as const) {
  test(`the History page and the file timeline split view with Radix, ${theme}`, async () => {
    test.setTimeout(120_000);
    const s = makeSandbox(`history-radix-${theme}`);
    fs.writeFileSync(path.join(s.folder, "plan.md"), "mi plan original\n");
    fs.writeFileSync(path.join(s.folder, "data.json"), '{ "plan": "original" }\n');
    const { app, page } = await launch(s, { claude: script });
    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.getByRole("button", { name: "Start Demo" }).click();
      await page.getByRole("region", { name: START }).getByRole("button", { name: /The manifest/ }).click();
      await expect(page.getByRole("main").getByText("Cambié tu plan.")).toBeVisible();
      await expect.poll(() => readTasks(s.folder).current?.status).toBe("waiting");

      // History: its own page, the h1 focused, Back in the top bar.
      await page.getByRole("button", { name: "History", exact: true }).click();
      const history = page.getByRole("region", { name: "History", exact: true });
      await expect(history.getByRole("heading", { level: 1, name: "History" })).toBeFocused();
      await expect(history.getByRole("button", { name: /The manifest.*2 files changed/ })).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator(".hh-shell header.hh-topbar").getByRole("button", { name: /^Back to/ })).toBeVisible();
      await shot(page, `history-page-radix-${theme}`);
      await page.setViewportSize({ width: 700, height: 900 });
      await page.waitForTimeout(300);
      await shot(page, `history-page-radix-${theme}-narrow`);
      await page.setViewportSize({ width: 1280, height: 900 });

      // A file the reader can't open shows its timeline in the split view, next to the chat.
      await history.getByRole("button", { name: "History of data.json" }).click();
      const split = page.getByRole("region", { name: "File history", exact: true });
      await expect(split).toContainText("data.json");
      await expect(history).toBeHidden();
      await expect(page.getByRole("main").getByRole("textbox")).toBeVisible();
      const list = split.getByRole("list", { name: "Versions and changes" });
      await expect(list).toBeVisible();
      await shot(page, `timeline-split-radix-${theme}`);

      // An entry's diff, in the same split view.
      await list.getByRole("button").first().click();
      await expect(split.getByRole("region", { name: "Changes" })).toContainText("cambiado");
      await shot(page, `timeline-split-diff-radix-${theme}`);

      // The focus is on the way back; Escape goes back to the list, then closes.
      await expect(split.getByRole("button", { name: "Back to the list" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(list).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(split).toBeHidden();
    } finally {
      await closeAndClean(app, s);
    }
  });
}
