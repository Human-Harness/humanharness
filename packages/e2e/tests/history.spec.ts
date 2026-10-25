import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { closeAndClean, launch, makeSandbox } from "./helpers";
import { historyScript } from "./scripts";

const START = "Which part do you want to understand?";
const readTasks = (folder: string) => JSON.parse(fs.readFileSync(path.join(folder, ".harness", "tasks.json"), "utf8"));
const plan = (folder: string) => fs.readFileSync(path.join(folder, "plan.md"), "utf8");

test("a turn edits a file; going back to before the task brings it back, and the panel shows the restore", async () => {
  const s = makeSandbox("history");
  fs.writeFileSync(path.join(s.folder, "plan.md"), "mi plan original\n");
  const { app, page } = await launch(s, { claude: historyScript });
  try {
    await page.getByRole("button", { name: "Start Demo" }).click();
    await page.getByRole("region", { name: START }).getByRole("button", { name: /The manifest/ }).click();
    await expect(page.getByRole("main").getByText("Cambié tu plan.")).toBeVisible();
    // The text shows before the turn ends: wait until the task waits (its commit is made by then).
    await expect.poll(() => readTasks(s.folder).current?.status).toBe("waiting");
    expect(plan(s.folder)).toBe("cambiado por la IA\n");

    await page.getByRole("button", { name: "History", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "History" });
    await expect(panel.getByRole("button", { name: /The manifest.*1 file changed/ })).toHaveAttribute("aria-expanded", "true");
    await expect(panel.getByRole("list", { name: "Changed files" }).getByText("plan.md")).toBeVisible();
    await panel.getByRole("button", { name: "Go back to before this task" }).click();
    await panel.getByRole("button", { name: "Yes, go back" }).click();
    await expect(panel).toBeHidden();
    await expect.poll(() => plan(s.folder)).toBe("mi plan original\n");

    // The restore carries no task: it shows under "Other changes", and the task's own row keeps what it changed.
    await page.getByRole("button", { name: "History", exact: true }).click();
    const again = page.getByRole("dialog", { name: "History" });
    await expect(again.getByRole("button", { name: /The manifest.*1 file changed/ })).toHaveAttribute("aria-expanded", "true");
    await again.getByRole("button", { name: /Other changes/ }).click();
    await expect(again.getByText("You went back to before this task")).toBeVisible();
  } finally {
    await closeAndClean(app, s);
  }
});
