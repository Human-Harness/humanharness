import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, type Page, expect, test } from "@playwright/test";
import { type ClaudeScript, claudeResultLine, claudeTextLines } from "@humanharness/fake-agent";
import { type Sandbox, answerGoBack, closeAndClean, launch, makeSandbox, readJsonl, shellDir } from "./helpers";

// Linked folders (hatches spec part 1): a project links a folder with its own git and a plain one, both outside the
// work folder. A turn reaches both through --settings, AGENTS.md names them, and Undo takes back only the plain one
// (the app's history tracks it; the git folder is left to its own git).
const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, "../../fake-agent/fixtures/hatches-harness");
const out = path.join(shellDir, "out", "hatches");

/**
 * The fake-claude script: the implement task writes one file in each linked folder and none in the work folder (the
 * History panel lists a task that changed only linked folders too).
 */
const script = (repo: string, notes: string): ClaudeScript => ({
  steps: [...claudeTextLines("Listo."), claudeResultLine(true)],
  turns: [
    {
      match: "# Task: implement",
      steps: [
        { write: { path: path.join(repo, "a.txt"), content: "a\n" } },
        { write: { path: path.join(notes, "b.txt"), content: "b\n" } },
        ...claudeTextLines("Cambié las dos carpetas."),
        claudeResultLine(true),
      ],
    },
  ],
});

/** The sandbox's two folders to link, outside the work folder: `repo` has its own git, `notes` doesn't. */
function folders(s: Sandbox): { repo: string; notes: string } {
  const repo = path.join(s.root, "repo");
  const notes = path.join(s.root, "notes");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
  fs.writeFileSync(path.join(repo, "README.md"), "repo\n");
  fs.mkdirSync(notes, { recursive: true });
  fs.writeFileSync(path.join(notes, "keep.md"), "notes\n");
  return { repo, notes };
}

/** The main process's folder picker answers `folder` (no native dialog in tests). */
async function pickAnswers(app: ElectronApplication, folder: string) {
  await app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as unknown as typeof dialog.showOpenDialog;
  }, folder);
}

/** Creates and opens the project "App" (ScopePicker), then opens its settings. */
async function openAppSettings(page: Page) {
  await page.getByRole("button", { name: "New Project" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("App");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("combobox", { name: "Choose Project" })).toHaveValue("app");
  await page.getByRole("button", { name: "App settings" }).click();
  const sheet = page.getByRole("dialog", { name: "App settings" });
  await expect(sheet.getByRole("heading", { name: "Linked folders" })).toBeVisible();
  return sheet;
}

const scopesFile = (s: Sandbox) => path.join(s.folder, ".harness", "scopes.json");

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  // electron-vite directly (as jobs.spec): `humanharness dev --build` would first run `check`, which needs a HARNESS.md.
  test.setTimeout(600_000);
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: out };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
});

test.afterAll(() => {
  fs.rmSync(out, { recursive: true, force: true });
});

test("link a git folder and a plain one; a turn edits both; undo restores only the plain one", async () => {
  const s = makeSandbox("hatches-linked");
  const { repo, notes } = folders(s);
  // As main stores them: the real path, in the case on disk.
  const realRepo = fs.realpathSync.native(repo);
  const realNotes = fs.realpathSync.native(notes);
  let app: ElectronApplication | undefined;
  try {
    const launched = await launch(s, { claude: script(realRepo, realNotes) }, path.join(out, "main", "index.js"));
    app = launched.app;
    const page = launched.page;
    await page.getByRole("button", { name: "Start Hatches" }).click();

    const sheet = await openAppSettings(page);
    const linkRepos = sheet.getByRole("button", { name: "Link a folder… (Repos)" });
    await pickAnswers(app, repo);
    await linkRepos.click();
    await expect(sheet.getByText(realRepo, { exact: true })).toBeVisible();
    await pickAnswers(app, notes);
    await linkRepos.click();
    await expect(sheet.getByText(realNotes, { exact: true })).toBeVisible();
    // Each row says who keeps its history: the repo its own git, the plain folder the app's.
    const row = (p: string) => sheet.getByRole("listitem").filter({ has: page.getByText(p, { exact: true }) });
    await expect(row(realRepo)).toContainText("Has its own git");
    await expect(row(realNotes)).toContainText("Tracked by the app's history");
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(sheet).toBeHidden();

    // The links are stored signed, in the order they were made.
    const stored = JSON.parse(fs.readFileSync(scopesFile(s), "utf8")) as { id: string; linked?: { key: string; path: string; mode: string; tracked: boolean }[] }[];
    const app_ = stored.find((e) => e.id === "app")!;
    expect(app_.linked?.map((l) => [l.key, l.path, l.mode, l.tracked])).toEqual([
      ["repos", realRepo, "write", false],
      ["repos", realNotes, "write", true],
    ]);

    // The task: it writes in both folders.
    await page.getByRole("button", { name: /Implement/ }).first().click();
    await expect(page.getByRole("main").getByText("Cambié las dos carpetas.")).toBeVisible();
    await expect.poll(() => fs.existsSync(path.join(realNotes, "b.txt"))).toBe(true);
    expect(fs.readFileSync(path.join(realRepo, "a.txt"), "utf8")).toBe("a\n");

    // AGENTS.md (written when the task's session starts) names both folders.
    const instructions = fs.readFileSync(path.join(s.folder, "AGENTS.md"), "utf8");
    expect(instructions).toContain("### Folders of this scope");
    expect(instructions).toContain(realRepo);
    expect(instructions).toContain(realNotes);

    // The turn's argv: one --settings with both folders, never --add-dir; the write folders' config is denied.
    const run = readJsonl<{ argv: string[]; prompt: string }>(s.claudePrompts).find((r) => r.prompt.includes("# Task: implement"))!;
    expect(run).toBeDefined();
    expect(run.argv).not.toContain("--add-dir");
    expect(run.argv.filter((a) => a === "--settings")).toHaveLength(1);
    const settings = JSON.parse(run.argv[run.argv.indexOf("--settings") + 1]) as { permissions: { additionalDirectories: string[] } };
    expect(settings.permissions.additionalDirectories).toEqual([realRepo, realNotes]);
    const denied = run.argv[run.argv.indexOf("--disallowedTools") + 1].split(",");
    for (const rule of [`Edit(/${realRepo}/.git/**)`, `Edit(/${realRepo}/.claude/**)`, `Edit(/${realNotes}/.git/**)`, `Write(/${realRepo}/.git/**)`]) {
      expect(denied).toContain(rule);
    }

    // The plain folder's history lives in the app's data, named by its real path's hash; the repo gets none.
    const gitdir = (p: string) => path.join(s.userData, "linked-history", createHash("sha256").update(p).digest("hex").slice(0, 16));
    await expect.poll(() => fs.existsSync(gitdir(realNotes))).toBe(true);
    expect(fs.existsSync(gitdir(realRepo))).toBe(false);

    // History: the git folder is named as not covered; the task changed only linked folders, and its row lists the
    // plain folder's file. Undoing it takes back the plain folder's changes, never the repo's.
    await page.getByRole("button", { name: "History", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "History" });
    await expect(panel.getByText("Repos: Undo doesn't cover this folder: it has its own git.")).toBeVisible();
    await expect(panel.getByRole("list", { name: "Repos" }).getByText("b.txt")).toBeVisible();
    await answerGoBack(app, "Go back");
    await panel.getByRole("button", { name: "Undo this task" }).click();
    await expect(panel).toBeHidden();
    await expect.poll(() => fs.existsSync(path.join(realNotes, "b.txt"))).toBe(false);
    expect(fs.readFileSync(path.join(realNotes, "keep.md"), "utf8")).toBe("notes\n");
    expect(fs.readFileSync(path.join(realRepo, "a.txt"), "utf8")).toBe("a\n");
    // The repo's own git was never touched.
    expect(fs.readdirSync(path.join(realRepo, ".git"))).toEqual(["HEAD"]);
  } finally {
    if (app) await closeAndClean(app, s);
    else fs.rmSync(s.root, { recursive: true, force: true });
  }
});

test("the picker refuses the work folder through a symbolic link, linking nothing", async () => {
  // Never the real home: the refusal comes from the work folder itself (not ~/.claude), reached through a link.
  const s = makeSandbox("hatches-refused");
  const through = path.join(s.root, "through-link");
  fs.symlinkSync(s.folder, through, "dir");
  let app: ElectronApplication | undefined;
  try {
    const launched = await launch(s, { claude: { steps: [...claudeTextLines("Listo."), claudeResultLine(true)] } }, path.join(out, "main", "index.js"));
    app = launched.app;
    const page = launched.page;
    await page.getByRole("button", { name: "Start Hatches" }).click();

    const sheet = await openAppSettings(page);
    await pickAnswers(app, through);
    await sheet.getByRole("button", { name: "Link a folder… (Repos)" }).click();
    const alert = sheet.getByRole("alert");
    await expect(alert).toHaveText("This is your work folder, or inside or around it. Link a folder outside it.");
    await expect(alert).toBeFocused();
    await expect(sheet.getByRole("listitem")).toHaveCount(0);

    const stored = JSON.parse(fs.readFileSync(scopesFile(s), "utf8")) as Record<string, unknown>[];
    expect(stored.map((e) => e.id)).toEqual(["app"]);
    expect(stored.every((e) => !("linked" in e))).toBe(true);
    expect(fs.existsSync(path.join(s.userData, "linked-history"))).toBe(false);
  } finally {
    if (app) await closeAndClean(app, s);
    else fs.rmSync(s.root, { recursive: true, force: true });
  }
});
