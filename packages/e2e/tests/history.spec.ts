import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { answerGoBack, closeAndClean, goBackAsks, launch, makeSandbox } from "./helpers";
import { historyScript } from "./scripts";

const START = "Which part do you want to understand?";
const readTasks = (folder: string) => JSON.parse(fs.readFileSync(path.join(folder, ".harness", "tasks.json"), "utf8"));
const plan = (folder: string) => fs.readFileSync(path.join(folder, "plan.md"), "utf8");

// The e2e package doesn't depend on isomorphic-git: borrow the workspace package's copy, the one History writes with.
const here = path.dirname(fileURLToPath(import.meta.url));
const gitEntry = createRequire(path.resolve(here, "../../workspace/package.json")).resolve("isomorphic-git");
type GitLog = { log(o: { fs: typeof fs; gitdir: string }): Promise<{ commit: { message: string } }[]> };

/** Each commit's whole message (subject and trailers, trimmed) in the folder's history, oldest first. */
async function messages(userData: string, folder: string): Promise<string[]> {
  const git = ((await import(pathToFileURL(gitEntry).href)) as { default: GitLog }).default;
  // As historyDir (shell config.ts) derives it: one gitdir per folder, named by the folder's hash.
  const gitdir = path.join(userData, "history", createHash("sha256").update(folder).digest("hex").slice(0, 16));
  return (await git.log({ fs, gitdir })).map((e) => e.commit.message.trim()).reverse();
}

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
    const task: string = readTasks(s.folder).current.id;

    await page.getByRole("button", { name: "History", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "History" });
    await expect(panel.getByRole("button", { name: /The manifest.*1 file changed/ })).toHaveAttribute("aria-expanded", "true");
    await expect(panel.getByRole("list", { name: "Changed files" }).getByText("plan.md")).toBeVisible();
    // Main asks with a native sheet (answered here through the test hook); the window draws no confirmation.
    // Cancel: nothing changes and the panel stays, for a task and for a point (the whole folder).
    await answerGoBack(app, "Cancel");
    await panel.getByRole("button", { name: "Undo this task" }).click();
    await expect.poll(async () => (await goBackAsks(app)).length).toBe(1);
    await panel.getByRole("button", { name: "Go back here" }).first().click();
    await expect.poll(async () => (await goBackAsks(app)).length).toBe(2);
    const [task, point] = await goBackAsks(app);
    expect(task).toMatchObject({ message: "Undo “The manifest”?", detail: "Everything it changed in your files will be undone.", buttons: ["Go back", "Cancel"], attached: true });
    expect(point).toMatchObject({ message: "Go back the whole folder to this point?", buttons: ["Go back", "Cancel"], attached: true });
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("button", { name: "Undo this task" })).toBeEnabled();
    expect(plan(s.folder)).toBe("cambiado por la IA\n");

    await answerGoBack(app, "Go back");
    await panel.getByRole("button", { name: "Undo this task" }).click();
    await expect(panel).toBeHidden();
    await expect.poll(() => plan(s.folder)).toBe("mi plan original\n");

    // The restore carries no task: it shows under "Outside a task", and the task's own row keeps what it changed.
    await page.getByRole("button", { name: "History", exact: true }).click();
    const again = page.getByRole("dialog", { name: "History" });
    await expect(again.getByRole("button", { name: /The manifest.*1 file changed/ })).toHaveAttribute("aria-expanded", "true");
    await again.getByRole("button", { name: /Outside a task/ }).click();
    await expect(again.getByText("You went back to before this task")).toBeVisible();

    // D0 (parallel spec D7): the demo harness declares no `parallel`, so its commits are exactly today's:
    // no Job: or Shared: trailers, no Shared: commit. The task id is the only thing that changes between runs.
    expect(await messages(s.userData, s.folder)).toEqual([
      "Start",
      `Turn: # Topic: the manifest Explain what a harness declares in \`h\n\nTask: ${task}\nAction: manifest`,
      "Went back to before the task",
    ]);
  } finally {
    await closeAndClean(app, s);
  }
});
