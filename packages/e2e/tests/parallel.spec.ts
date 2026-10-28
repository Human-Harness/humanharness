import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type ElectronApplication, type Page, expect, test } from "@playwright/test";
import type { ClaudeScript } from "@humanharness/fake-agent";
import { type Sandbox, answerGoBack, closeAndClean, goBackAsks, launch, makeSandbox, readJsonl, shellDir } from "./helpers";

// Parallel tasks (parallel spec §11): a harness that declares `parallel` keeps several tasks open, each with its own
// chat and session, and runs up to the cap of them at once.
const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, "../../fake-agent/fixtures/parallel-harness");
const outDir = path.join(shellDir, "out", "parallel");
/** `parallel`: write-a sleeps 800 ms; `slow`: 5 s (a "both" question 3 s), so another task can run meanwhile. */
const scenarios = JSON.parse(fs.readFileSync(path.join(fixture, "fake-script.json"), "utf8")).scenarios as { parallel: ClaudeScript; slow: ClaudeScript };

/**
 * `parallel` with one more choice after write-a: "Write B next" starts write-b, a new task from the open one (its
 * successor, as the guided path's next topic would).
 */
const withNext: ClaudeScript = {
  ...scenarios.parallel,
  turns: scenarios.parallel.turns!.map((t) =>
    t.match !== "# Task: write-a"
      ? t
      : {
          ...t,
          steps: t.steps.map((step) =>
            "mcp" in step && step.mcp.tool === "show_choices"
              ? { mcp: { ...step.mcp, args: { options: [{ label: "Write B next", action: "write-b" }, ...(step.mcp.args.options as unknown[])] } } }
              : step,
          ),
        },
  ),
};

type Lane = { id: string; action?: string; question?: string; status: string };
const readTasks = (folder: string): { lanes?: Lane[]; focus?: string | null } =>
  JSON.parse(fs.readFileSync(path.join(folder, ".harness", "tasks.json"), "utf8"));
const lanes = (folder: string): Lane[] => (fs.existsSync(path.join(folder, ".harness", "tasks.json")) ? (readTasks(folder).lanes ?? []) : []);
const laneOf = (folder: string, action: string) => lanes(folder).find((l) => l.action === action);
const exists = (folder: string, file: string) => fs.existsSync(path.join(folder, file));
/** Task `id`'s own chat (`.harness/chats/<scope>/<id>.jsonl`, spec §6); empty until it is written. */
function chatOf(s: Sandbox, id: string): { role: string; text: string }[] {
  const chats = path.join(s.folder, ".harness", "chats");
  if (!fs.existsSync(chats)) return [];
  const file = fs.readdirSync(chats, { recursive: true, encoding: "utf8" }).find((f) => path.basename(f) === `${id}.jsonl`);
  return file ? readJsonl<{ role: string; text: string }>(path.join(chats, file)) : [];
}

// The e2e package doesn't depend on isomorphic-git: borrow the workspace package's copy, the one History writes with.
const gitEntry = createRequire(path.resolve(here, "../../workspace/package.json")).resolve("isomorphic-git");
type TreeEntry = { path: string; oid: string; type: string };
type Git = {
  log(o: { fs: typeof fs; gitdir: string }): Promise<{ oid: string; commit: { message: string; tree: string; parent: string[] } }[]>;
  readTree(o: { fs: typeof fs; gitdir: string; oid: string }): Promise<{ tree: TreeEntry[] }>;
};

/** One commit of the folder's history: its whole message (trimmed) and the paths it changed from its parent. */
type Commit = { message: string; changed: string[] };

/** The folder's history, oldest first. Each commit's changed paths, read from the trees (subfolders walked). */
async function commits(s: Sandbox): Promise<Commit[]> {
  const git = ((await import(pathToFileURL(gitEntry).href)) as { default: Git }).default;
  // As historyDir (shell config.ts) derives it: one gitdir per folder, named by the folder's hash.
  const gitdir = path.join(s.userData, "history", createHash("sha256").update(s.folder).digest("hex").slice(0, 16));
  const files = async (tree: string, prefix = ""): Promise<Map<string, string>> => {
    const out = new Map<string, string>();
    for (const e of (await git.readTree({ fs, gitdir, oid: tree })).tree) {
      if (e.type === "tree") for (const [p, oid] of await files(e.oid, `${prefix}${e.path}/`)) out.set(p, oid);
      else out.set(`${prefix}${e.path}`, e.oid);
    }
    return out;
  };
  const log = (await git.log({ fs, gitdir })).reverse();
  const trees = new Map<string, Map<string, string>>();
  for (const e of log) trees.set(e.oid, await files(e.commit.tree));
  return log.map((e) => {
    const now = trees.get(e.oid)!;
    const before = e.commit.parent[0] ? (trees.get(e.commit.parent[0]) ?? new Map<string, string>()) : new Map<string, string>();
    const changed = [...new Set([...now.keys(), ...before.keys()])].filter((p) => now.get(p) !== before.get(p)).sort();
    return { message: e.commit.message.trim(), changed };
  });
}

/** The trailers a turn's commit carries for a task started from `action`. */
const turnOf = (id: string, action: string) => (c: Commit) => c.message.startsWith(`Turn: # Task: ${action}`) && c.message.endsWith(`\n\nTask: ${id}\nAction: ${action}`);

const inboxButton = (page: Page) => page.getByRole("button", { name: /^Inbox, \d+ waiting$/ });
/** Opens the inbox (unless it is open) and returns it. */
async function openInbox(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Inbox" });
  if (!(await dialog.isVisible())) await inboxButton(page).click();
  await expect(dialog).toBeVisible();
  return dialog;
}
const section = (page: Page, title: "Waiting for you" | "Working" | "Queued") => page.getByRole("dialog", { name: "Inbox" }).getByRole("region", { name: title });
/** Opens the inbox and focuses the open task labelled `label`. */
async function focusTask(page: Page, label: string) {
  const dialog = await openInbox(page);
  await dialog.getByRole("button", { name: new RegExp(`^${label}`) }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("group", { name: "Task on screen" })).toContainText(label);
}
/** The start view's topic `label`. */
const topic = (page: Page, label: string) => page.getByRole("region", { name: "Where do we start?" }).getByRole("button", { name: new RegExp(label) });
/** "New task" in the strip over the chat: the start view. */
async function newTask(page: Page) {
  await page.getByRole("group", { name: "Task on screen" }).getByRole("button", { name: "New task" }).click();
  await expect(page.getByRole("region", { name: "Where do we start?" })).toBeVisible();
}
const userLines = (page: Page) => page.getByRole("main").locator('[data-role="user"]');
const box = (page: Page) => page.getByRole("main").getByRole("textbox");

/** A launch of the fixture's build; the sandbox and the app go away at the end, whatever happens. */
async function withApp(name: string, script: ClaudeScript, run: (page: Page, s: Sandbox, app: ElectronApplication) => Promise<void>) {
  const s = makeSandbox(name);
  let app: ElectronApplication | undefined;
  try {
    const launched = await launch(s, { claude: script }, path.join(outDir, "main", "index.js"));
    app = launched.app;
    await launched.page.getByRole("button", { name: "Start Parallel" }).click();
    await run(launched.page, s, launched.app);
  } finally {
    if (app) await closeAndClean(app, s);
    else fs.rmSync(s.root, { recursive: true, force: true });
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  // electron-vite directly: `humanharness dev --build` would first run `check`, which a test fixture has no HARNESS.md for.
  test.setTimeout(300_000);
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: outDir };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
});

test.afterAll(() => {
  fs.rmSync(outDir, { recursive: true, force: true });
});

test("two tasks run at once, the inbox follows them, and undoing one leaves the other's file and task", async () => {
  await withApp("parallel-two", scenarios.slow, async (page, s, app) => {
    await topic(page, "Write A").click();
    // The first task works (5 s) when the second starts from the start view.
    await expect.poll(() => laneOf(s.folder, "write-a")?.status).toBe("running");
    await openInbox(page);
    await expect(section(page, "Working").getByRole("button", { name: /^Write A/ })).toBeVisible();
    await page.getByRole("dialog", { name: "Inbox" }).getByRole("button", { name: "New task" }).click();
    await topic(page, "Write B").click();
    await expect(page.getByRole("main").getByText("Wrote b.")).toBeVisible();
    // The second has finished while the first still works: both ran at once.
    await openInbox(page);
    await expect(section(page, "Waiting for you").getByRole("button", { name: /^Write B/ })).toBeVisible();
    await expect(section(page, "Working").getByRole("button", { name: /^Write A/ })).toBeVisible();
    await expect(inboxButton(page)).toHaveAccessibleName("Inbox, 1 waiting");
    // Then both wait.
    await expect(inboxButton(page)).toHaveAccessibleName("Inbox, 2 waiting", { timeout: 30_000 });
    await expect(section(page, "Waiting for you").getByRole("button")).toHaveCount(2);
    await expect(section(page, "Working").getByRole("button")).toHaveCount(0);
    await expect.poll(() => lanes(s.folder).map((l) => l.status)).toEqual(["waiting", "waiting"]);
    expect(exists(s.folder, "a.md") && exists(s.folder, "b.md")).toBe(true);

    // Each turn's commit holds its own file only, and the second task's turn was saved first.
    const a = laneOf(s.folder, "write-a")!.id;
    const b = laneOf(s.folder, "write-b")!.id;
    const history = await commits(s);
    expect(history.map((c) => c.message.split("\n")[0].replace(/^(Turn: # Task: write-[ab]).*/, "$1"))).toEqual([
      "Start",
      "Turn: # Task: write-b",
      "Turn: # Task: write-a",
    ]);
    expect(history.find(turnOf(b, "write-b"))?.changed).toEqual(["b.md"]);
    expect(history.find(turnOf(a, "write-a"))?.changed).toEqual(["a.md"]);
    expect(history.some((c) => /^(Shared|Job):/m.test(c.message))).toBe(false);

    // Undo the second task, whose turn was saved first: its file goes; the first task's later turn changed another
    // file, so it is neither undone nor counted, and its file and task stay.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "History", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "History" });
    const rowB = panel.locator("li", { has: page.getByRole("button", { name: /^Write B.*1 file changed/ }) });
    const header = rowB.getByRole("button", { name: /^Write B.*1 file changed/ });
    if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
    // Main asks with its native dialog (answered through the test hook), naming no later task; the window draws none.
    await answerGoBack(app, "Go back");
    await rowB.getByRole("button", { name: "Undo this task" }).click();
    await expect.poll(async () => (await goBackAsks(app)).length).toBe(1);
    const [asked] = await goBackAsks(app);
    expect(asked).toMatchObject({ message: "Undo “Write B”?", detail: "Everything it changed in your files will be undone.", buttons: ["Go back", "Cancel"], attached: true });
    expect(asked.detail).not.toMatch(/later task/);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(panel).toBeHidden();
    await expect.poll(() => exists(s.folder, "b.md")).toBe(false);
    expect(fs.readFileSync(path.join(s.folder, "a.md"), "utf8")).toBe("a\n");
    await openInbox(page);
    await expect(section(page, "Waiting for you").getByRole("button", { name: /^Write A/ })).toBeVisible();
    expect(laneOf(s.folder, "write-a")?.status).toBe("waiting");
    // The undo is its own commit, of b.md alone.
    expect((await commits(s)).at(-1)?.changed).toEqual(["b.md"]);
  });
});

test("focusing a task mid-turn replays its live turn, and a draft never follows to another task", async () => {
  await withApp("parallel-focus", scenarios.slow, async (page, s) => {
    await topic(page, "Write A").click();
    await expect(userLines(page)).toHaveCount(1);
    await expect.poll(() => laneOf(s.folder, "write-a")?.status).toBe("running");
    await newTask(page);
    await topic(page, "Write B").click();
    await expect(page.getByRole("main").getByText("Wrote b.")).toBeVisible();
    // A half-typed message in the second task stays there: the first task's box is empty.
    await box(page).fill("half typed");
    await focusTask(page, "Write A");
    await expect(box(page)).toHaveValue("");
    // The first task's chat: its own line once, its turn still live, nothing of the second's.
    await expect(userLines(page)).toHaveCount(1);
    await expect(userLines(page)).toContainText("Write A");
    await expect(page.getByRole("main").getByText("Wrote b.")).toHaveCount(0);
    expect(laneOf(s.folder, "write-a")?.status).toBe("running");
    // Away and back while the turn still runs, then it ends on screen.
    await focusTask(page, "Write B");
    await expect(page.getByRole("main").getByText("Wrote b.")).toBeVisible();
    await focusTask(page, "Write A");
    await expect(page.getByRole("main").getByText("Wrote a.")).toBeVisible({ timeout: 30_000 });
    await expect(userLines(page)).toHaveCount(1);
    await expect(page.getByRole("main").getByText("Wrote b.")).toHaveCount(0);
    await expect.poll(() => laneOf(s.folder, "write-a")?.status).toBe("waiting");
  });
});

test("a task started from an open one runs in its own lane, with its own chat", async () => {
  await withApp("parallel-successor", withNext, async (page, s) => {
    await topic(page, "Write A").click();
    await expect(page.getByRole("main").getByText("Wrote a.")).toBeVisible();
    await expect.poll(() => laneOf(s.folder, "write-a")?.status).toBe("waiting");
    const a = laneOf(s.folder, "write-a")!.id;
    // A next topic while the first task waits: the first closes (its note), the second starts in a new lane.
    await page.getByRole("main").getByRole("button", { name: "Write B next" }).click();
    await expect(page.getByRole("main").getByText("Wrote b.")).toBeVisible();
    await expect.poll(() => lanes(s.folder).map((l) => l.action)).toEqual(["write-b"]);
    const b = laneOf(s.folder, "write-b")!.id;
    expect(b).not.toBe(a);
    await expect.poll(() => laneOf(s.folder, "write-b")?.status).toBe("waiting");
    // Another topic takes the chat on screen, as in the plain app: the new task's line only.
    await expect(page.getByRole("main").getByText("Wrote a.")).toHaveCount(0);
    await expect(userLines(page)).toHaveCount(1);
    await expect(userLines(page)).toContainText("Write B");
    await openInbox(page);
    await expect(section(page, "Waiting for you").getByRole("button")).toHaveCount(1);
    await expect(section(page, "Waiting for you").getByRole("button", { name: /^Write B/ })).toBeVisible();
    await page.keyboard.press("Escape");

    // Each task's chat file holds its own turns only.
    const textsOf = (id: string) => chatOf(s, id).map((e) => e.text);
    await expect.poll(() => textsOf(a)).toContain("Wrote a.");
    expect(textsOf(a)).not.toContain("Wrote b.");
    await expect.poll(() => textsOf(b)).toContain("Wrote b.");
    expect(textsOf(b)).not.toContain("Wrote a.");
    expect(chatOf(s, b).filter((e) => e.role === "user").map((e) => e.text)).toEqual(["Write B"]);

    // Opened again from the inbox, the second task shows only its own chat.
    await newTask(page);
    await focusTask(page, "Write B");
    await expect(page.getByRole("main").getByText("Wrote b.")).toBeVisible();
    await expect(page.getByRole("main").getByText("Wrote a.")).toHaveCount(0);
    await expect(userLines(page)).toHaveCount(1);
  });
});

test("two tasks that change the same file are both told", async () => {
  await withApp("parallel-conflict", scenarios.slow, async (page, s) => {
    const ask = async (text: string) => {
      await box(page).fill(text);
      await box(page).press("Enter");
      await expect(userLines(page).last()).toContainText(text);
    };
    await ask("both one");
    await newTask(page);
    // The second asks while the first still works (3 s), so the two turns overlap.
    await expect.poll(() => lanes(s.folder).map((l) => l.status)).toEqual(["running"]);
    await ask("both two");
    await expect.poll(() => lanes(s.folder).map((l) => l.status), { timeout: 30_000 }).toEqual(["waiting", "waiting"]);
    expect(fs.readFileSync(path.join(s.folder, "spec.md"), "utf8")).toBe("spec\n");
    // The task on screen shows its notice without a reload, whichever turn ended first: a system line, not a step.
    const live = page.getByRole("main").getByText("This task and “both one” both changed spec.md.");
    await expect(live).toBeVisible();
    await expect(page.getByRole("main").getByText(/Working on/)).toHaveCount(0);
    // Both tasks are marked in the inbox, and each chat, opened again, says which other task changed the file.
    await openInbox(page);
    await expect(page.getByRole("dialog", { name: "Inbox" }).getByText("Another task changed the same files")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await focusTask(page, "both one");
    await expect(page.getByRole("main").getByText("This task and “both two” both changed spec.md.")).toBeVisible();
    await focusTask(page, "both two");
    await expect(page.getByRole("main").getByText("This task and “both one” both changed spec.md.")).toBeVisible();
  });
});

test("at one task at a time, the second waits in the queue and the commits are today's", async () => {
  await withApp("parallel-cap1", scenarios.slow, async (page, s) => {
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tabpanel", { name: "General" }).getByLabel("Tasks at once").selectOption("1");
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(s.userData, "config.json"), "utf8")).parallel).toEqual({ tasks: 1 });
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await topic(page, "Write A").click();
    await expect.poll(() => laneOf(s.folder, "write-a")?.status).toBe("running");
    await newTask(page);
    await topic(page, "Write B").click();
    // The second message waits for the first task's turn to end.
    await openInbox(page);
    await expect(section(page, "Queued").getByRole("button", { name: /^Write B/ })).toBeVisible();
    await expect(section(page, "Working").getByRole("button", { name: /^Write A/ })).toBeVisible();
    expect(exists(s.folder, "b.md")).toBe(false);
    await expect(inboxButton(page)).toHaveAccessibleName("Inbox, 2 waiting", { timeout: 30_000 });
    await expect(section(page, "Queued").getByRole("button")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("main").getByText("Wrote b.")).toBeVisible();

    // One turn at a time: each commit as the plain app makes it, no Shared: commit and no shared trailer.
    const a = laneOf(s.folder, "write-a")!.id;
    const b = laneOf(s.folder, "write-b")!.id;
    const history = await commits(s);
    expect(history).toHaveLength(3);
    expect(history[0]).toMatchObject({ message: "Start" });
    expect(turnOf(a, "write-a")(history[1])).toBe(true);
    expect(history[1].changed).toEqual(["a.md"]);
    expect(turnOf(b, "write-b")(history[2])).toBe(true);
    expect(history[2].changed).toEqual(["b.md"]);
  });
});
