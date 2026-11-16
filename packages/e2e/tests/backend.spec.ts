import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, type Page, expect, test } from "@playwright/test";
import { closeAndClean, launchMock, makeSandbox, shellDir } from "./helpers";

// The harness backend end to end (hatches spec §4). It runs on the backend-harness fixture: the demo has no backend.
const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/backend-harness");
const outDir = path.join(shellDir, "out", "backend");
const ENTRY = /fixtures\/backend-harness\/backend\/index\.ts/;

// One full app build of the fixture for the whole file.
test.beforeAll(() => {
  test.setTimeout(300_000);
  // electron-vite directly: `humanharness dev --build` would first run `check`, which a test fixture has no HARNESS.md for.
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: outDir };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit", timeout: 240_000 });
});

/** The demo's backend process: a child of the app's main process whose command line names its entry (POSIX). */
function backendPid(app: ElectronApplication): number | null {
  const main = app.process().pid;
  const rows = execFileSync("ps", ["-A", "-ww", "-o", "pid=,ppid=,command="], { encoding: "utf8" }).split("\n");
  for (const row of rows) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(row);
    if (m && Number(m[2]) === main && ENTRY.test(m[3])) return Number(m[1]);
  }
  return null;
}

/** Waits for a backend process other than `not` (the one just killed) and returns its pid. */
async function nextBackend(app: ElectronApplication, not: number | null): Promise<number> {
  let pid: number | null = null;
  await expect.poll(() => (pid = backendPid(app)) !== null && pid !== not, { timeout: 15_000 }).toBe(true);
  return pid!;
}

async function openPanel(page: Page) {
  await expect(page.getByText("Test mode (no AI)")).toBeVisible();
  const panel = page.getByRole("region", { name: "Backend" });
  await expect(panel).toBeVisible();
  return panel;
}

test("the fixture's echo backend answers and streams events in mock mode", async () => {
  const s = makeSandbox("backend");
  const { app, page } = await launchMock(s, undefined, path.join(outDir, "main", "index.js"));
  try {
    const panel = await openPanel(page);
    await panel.getByRole("button", { name: "Echo" }).click();
    await expect(panel.getByTestId("fx-backend-echo")).toHaveText("hello (mock: true)");

    await panel.getByRole("button", { name: "Stream" }).click();
    await expect(panel.getByTestId("fx-backend-sent")).toHaveText("sent 3");
    await expect(panel.getByRole("list", { name: "Ticks" }).getByRole("listitem")).toHaveText(["tick 0", "tick 1", "tick 2"]);
    await expect(page.getByRole("alert").filter({ hasText: "The harness's helper stopped working." })).toHaveCount(0);
  } finally {
    await closeAndClean(app, s);
  }
});

test("a backend killed from outside restarts; after three restarts the card offers Restart", async () => {
  test.skip(process.platform === "win32", "finds the backend with ps");
  const s = makeSandbox("backend-crash");
  const { app, page } = await launchMock(s, undefined, path.join(outDir, "main", "index.js"));
  try {
    const panel = await openPanel(page);
    const card = page.getByRole("alert").filter({ hasText: "The harness's helper stopped working." });
    let pid = await nextBackend(app, null);

    // One crash: the supervisor starts it again and Echo answers.
    process.kill(pid, "SIGKILL");
    pid = await nextBackend(app, pid);
    await panel.getByRole("button", { name: "Echo" }).click();
    await expect(panel.getByTestId("fx-backend-echo")).toHaveText("hello (mock: true)");
    await expect(card).toHaveCount(0);

    // Three more within five minutes: the fourth crash is past the limit (B6), so it stays down.
    for (let i = 0; i < 2; i++) {
      process.kill(pid, "SIGKILL");
      pid = await nextBackend(app, pid);
    }
    process.kill(pid, "SIGKILL");
    await expect(card).toBeVisible();
    expect(backendPid(app)).toBeNull();
    await panel.getByRole("button", { name: "Echo" }).click();
    await expect(panel.getByRole("alert")).toHaveText("The backend isn't running");

    // Restart: main starts it and pushes the new state, which takes the card away; Echo answers again.
    await card.getByRole("button", { name: "Restart" }).click();
    await expect(card).toHaveCount(0);
    await nextBackend(app, pid);
    await panel.getByRole("button", { name: "Echo" }).click();
    await expect(panel.getByRole("alert")).toHaveCount(0);
    await expect(panel.getByTestId("fx-backend-echo")).toHaveText("hello (mock: true)");
  } finally {
    await closeAndClean(app, s);
  }
});
