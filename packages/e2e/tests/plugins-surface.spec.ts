import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, type FrameLocator, type Page, expect, test } from "@playwright/test";
import { type ClaudeScript, claudeTextLines } from "@humanharness/fake-agent";
import { type Sandbox, closeAndClean, launch, launchMock, makeSandbox, profileFlags, readJsonl, shellDir } from "./helpers";
import { claudeScript } from "./scripts";

// Plugins, part 2 (plugins spec §10.2): what a running plugin draws in the app window. The demo's bundled on-this-day
// on its fixtures (never Wikimedia): its panel, chip, inbox item and prepared task. The probe's hand-written panel tries
// every way out of its frame (threat model P1–P7). And D0: a harness without plugins draws and registers nothing.

type Run = { argv: string[]; prompt: string };

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../fixtures/plugins");
const plainHarness = path.resolve(here, "../../fake-agent/fixtures/settings-harness");
const START = "Which part do you want to understand?";
const OTD = "On this day";
const EXPLAIN = "Explain this event from";

/** The year among the fixture's (1901–1925) that is a whole multiple of 25 years ago, and how many years. */
function roundYear(): { year: number; age: number } {
  const now = new Date().getFullYear();
  for (let year = 1901; year <= 1925; year++) if ((now - year) % 25 === 0) return { year, age: now - year };
  throw new Error("no round year among the fixture's");
}

const result = {
  line: {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "",
    session_id: "fake-session",
    usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
  },
};
/** Claude: the demo's script, plus the prepared Explain question, which writes a file (so its turn makes a commit). */
const explainScript: ClaudeScript = {
  ...claudeScript,
  turns: [{ match: EXPLAIN, steps: [{ write: { path: "explained.md", content: "explained\n" } }, ...claudeTextLines("Un evento curioso."), result] }, ...(claudeScript.turns ?? [])],
};

/** All windows: the app's and any plugin backend's. */
const windowCount = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

async function openPlugins(page: Page) {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("tab", { name: "Plugins" }).click();
  return page.getByRole("tabpanel", { name: "Plugins" });
}

/** A local server on 127.0.0.1 that counts every request and upgrade: it must stay at 0. */
async function countingServer(): Promise<{ port: number; hits: string[]; close(): Promise<void> }> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url ?? "?");
    res.setHeader("access-control-allow-origin", "*");
    res.end("ok");
  });
  server.on("upgrade", (req, socket) => {
    hits.push(`upgrade ${req.url ?? "?"}`);
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Writes a plugin's stored settings into the base before launch (the person's values, as Settings would). */
function writePluginSettings(s: Sandbox, id: string, values: Record<string, unknown>) {
  const dir = path.join(s.folder, ".harness", "plugins", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "settings.json"), `${JSON.stringify(values, null, 2)}\n`);
}

/** The last commit message in the folder's local history (the app keeps its git dir under userData). */
function lastCommit(s: Sandbox): string {
  const root = path.join(s.userData, "history");
  const [dir] = fs.readdirSync(root);
  return execFileSync("git", ["--git-dir", path.join(root, dir), "log", "-1", "--format=%B"], { encoding: "utf8" });
}

/** Settings › Plugins: turns the demo's bundled plugin on through its review. */
async function turnOnOnThisDay(page: Page) {
  const tab = await openPlugins(page);
  await tab.getByRole("switch", { name: OTD }).click();
  await expect(tab.getByRole("heading", { name: OTD })).toBeVisible();
  await expect(tab.getByText(/Connects to:\s*api\.wikimedia\.org/)).toBeVisible();
  await expect(tab.getByText("Can propose agent tasks")).toBeVisible();
  await tab.getByRole("button", { name: "Turn on" }).click();
  await expect(tab.getByRole("switch", { name: OTD })).toBeChecked();
  await page.getByRole("button", { name: "Done", exact: true }).click();
}

const otdFrame = (page: Page): FrameLocator => page.frameLocator(`iframe[title="${OTD} · ${OTD}"]`);

test("D0: a harness without plugins has no frame, chip, Plugins section or card, and no hh-plugin handler", async () => {
  // A full app build of a plugin-free fixture harness before the app starts.
  test.setTimeout(300_000);
  const s = makeSandbox("plugins-surface-d0");
  const outDir = path.join(shellDir, "out", "plugins-surface-d0");
  // electron-vite directly: `humanharness dev --build` would first run `check`, which a test fixture has no HARNESS.md for.
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: plainHarness, HH_OUT_DIR: outDir };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication | undefined;
  try {
    execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
    const tutor: ClaudeScript = { steps: [...claudeTextLines("Una pregunta corta."), result] };
    const launched = await launch(s, { claude: tutor }, path.join(outDir, "main", "index.js"));
    app = launched.app;
    const page = launched.page;
    await page.getByRole("button", { name: "Start Tutor" }).click();
    await page.getByRole("button", { name: /Practice/ }).first().click();
    await expect(page.getByRole("main").getByText("Una pregunta corta.")).toBeVisible();

    await expect(page.locator("iframe")).toHaveCount(0);
    await expect(page.locator(".hh-pl-chip")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Plugins" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Prepared task" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Attention" })).toHaveCount(0);
    expect(await app.evaluate(({ session }) => session.defaultSession.protocol.isProtocolHandled("hh-plugin"))).toBe(false);
    expect(await windowCount(app)).toBe(1);
  } finally {
    try {
      if (app) await closeAndClean(app, s);
      else fs.rmSync(s.root, { recursive: true, force: true });
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
});

test("the demo's On this day: off draws nothing; on, its panel, chip and inbox item; Explain prepares a task only Start runs", async () => {
  test.setTimeout(180_000);
  const s = makeSandbox("plugins-surface-demo");
  const { year, age } = roundYear();
  const { app, page } = await launch(s, { claude: explainScript }, undefined, { HH_PLUGIN_FIXTURES: "1" });
  try {
    // Off: the chat has no Plugins section, no frame, no chip, no inbox; no backend window.
    await page.getByRole("button", { name: "Start Demo" }).click();
    await expect(page.getByRole("region", { name: START })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Plugins" })).toHaveCount(0);
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect(page.locator(".hh-pl-chip")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Attention" })).toHaveCount(0);
    expect(await windowCount(app)).toBe(1);
    // D0: the panel handler, request filter and frame guard wait for the first plugin with panels.
    const handled = () => app.evaluate(({ session }) => session.defaultSession.protocol.isProtocolHandled("hh-plugin"));
    expect(await handled()).toBe(false);
    const tab = await openPlugins(page);
    const row = tab.getByRole("listitem").filter({ hasText: OTD });
    await expect(row.getByText("Bundled")).toBeVisible();
    await expect(tab.getByRole("switch", { name: OTD })).not.toBeChecked();
    expect(await windowCount(app)).toBe(1);
    await page.getByRole("button", { name: "Done", exact: true }).click();

    // On, after its review: the section's tab, 25 rows from the fixture, the chip, and an info item (no badge).
    await turnOnOnThisDay(page);
    await expect(page.getByRole("tablist", { name: "Plugin panels" }).getByRole("tab", { name: OTD })).toBeVisible();
    const frame = otdFrame(page);
    await expect(frame.locator("tbody tr")).toHaveCount(25);
    expect(await handled()).toBe(true);
    await expect(frame.getByText("Sample event for the demo (fixture), 1925.")).toBeVisible();
    await expect(page.locator(".hh-pl-chip")).toContainText(`${age}-year anniversary today`);
    const inbox = page.getByRole("button", { name: "Attention" });
    await expect(inbox).toBeVisible();
    await expect(inbox.locator(".hh-pl-badge")).toHaveCount(0);

    // The item's target: the panel's tab is selected and the row of that year is highlighted inside the frame.
    await inbox.click();
    const list = page.getByRole("dialog", { name: "Attention" });
    const item = list.getByRole("button", { name: new RegExp(`${age} years ago today`) });
    await expect(item).toContainText("Open");
    await item.click();
    await expect(page.getByRole("tab", { name: OTD })).toHaveAttribute("aria-selected", "true");
    await expect(frame.locator("tr.otd-focus")).toHaveCount(1);
    await expect(frame.locator('tr[aria-current="true"] .otd-year')).toHaveText(String(year));

    // Explain proposes a card; nothing has run.
    const runsBefore = readJsonl<Run>(s.claudePrompts).length;
    await frame.getByRole("button", { name: "Explain the event from 1925" }).click();
    const card = page.getByRole("region", { name: "Prepared task" });
    await expect(card).toBeVisible();
    await expect(card.locator(".hh-pl-prepared-title")).toHaveText(/^On this day · Explain this event/);
    const prompt = card.getByLabel("What the agent will be asked");
    await expect(prompt).toContainText(`${EXPLAIN} 1925 for someone curious`);
    await expect(prompt).toContainText("Sample event for the demo (fixture), 1925.");
    await expect(card.getByText("Model tier: Light")).toBeVisible();
    await page.waitForTimeout(500);
    expect(readJsonl<Run>(s.claudePrompts).length).toBe(runsBefore);

    // Cancel: the card leaves, still nothing ran.
    await card.getByRole("button", { name: "Cancel" }).click();
    await expect(card).toHaveCount(0);
    expect(readJsonl<Run>(s.claudePrompts).length).toBe(runsBefore);

    // Again (a plugin gets one card per 2 s), then Start once it arms.
    await expect(async () => {
      await frame.getByRole("button", { name: "Explain the event from 1925" }).click();
      await expect(card).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    const title = (await card.locator(".hh-pl-prepared-title").textContent())!.trim();
    const exact = (await prompt.textContent())!;
    const start = card.getByRole("button", { name: "Start" });
    await expect(start).toBeEnabled();
    await start.click();
    await expect(card).toHaveCount(0);
    await expect(page.getByRole("main").getByText(title)).toBeVisible();
    await expect(page.getByRole("main").getByText("Un evento curioso.")).toBeVisible();

    // P13: the engine got the card's exact prompt, at the action's tier (light: haiku, low effort).
    const run = readJsonl<Run>(s.claudePrompts).find((r) => r.prompt.includes(EXPLAIN));
    expect(run).toBeDefined();
    expect(run!.prompt).toContain(exact);
    expect(profileFlags(run!.argv).slice(0, 2)).toEqual(["haiku", "low"]);
    // The turn's commit names the plugin.
    await expect.poll(() => lastCommit(s), { timeout: 20_000 }).toContain("Plugin: on-this-day");
  } finally {
    await closeAndClean(app, s);
  }
});

/** The probe panel's round and outcomes by name (`data-probe` items and the controls), read in one step from one page. */
async function panelOutcomes(frame: FrameLocator): Promise<{ round: string | null; probes: Record<string, string>; controls: Record<string, string> }> {
  return frame.locator("body").evaluate((body) => {
    const read = (attr: string) => Object.fromEntries([...body.querySelectorAll(`li[${attr}]`)].map((li) => [li.getAttribute(attr), li.getAttribute("data-outcome")]));
    return { round: body.getAttribute("data-round"), probes: read("data-probe"), controls: read("data-control") };
  });
}

// Every attempt must come out "blocked", and the counting server must see no hit: the hit count is the proof for the
// ones a browser refuses from an opaque origin even without the app's guards (websocket, eventsource, img, import:
// "blocked" alone shows little). "worker" is a control of the probe itself: a Worker from an opaque-origin page to an
// http: URL is always refused, so it shows the attempt list runs, not a guard.
const PROBES = [
  "window.hh",
  "require",
  "process",
  "parent.document",
  "parent.hh",
  "fetch",
  "xhr",
  "websocket",
  "eventsource",
  "img",
  "script",
  "import",
  "worker",
  "prefetch",
  "window.open",
  "form",
  "backend-fetch",
  "other-fetch",
  "backend-script",
  "other-script",
  "nested-panel",
  "nested-srcdoc",
  "nested-data",
  "nested-blob",
  "nested-access",
  "style-element",
  "style-attribute",
  "other-navigation",
];

test("panel boundaries P1–P7: a hostile panel reaches no network, no app, no other file, and comes back after navigating", async () => {
  test.setTimeout(240_000);
  const s = makeSandbox("plugins-surface-probe");
  const server = await countingServer();
  // The control: the server counts a request that does reach it, so its zero below means something.
  await new Promise<void>((resolve, reject) => http.get(`http://127.0.0.1:${server.port}/control`, (res) => res.resume().on("end", resolve)).on("error", reject));
  expect(server.hits).toEqual(["/control"]);
  server.hits.length = 0;
  // The mark source syncs in work hours only: one day a week, never today, so only the panel's refresh runs it.
  const never = (new Date().getUTCDay() + 3) % 7;
  writePluginSettings(s, "probe", { panelPort: server.port, _workHours: { days: [never], from: "00:00", to: "00:00", timezone: "UTC" } });
  const dirs = [path.join(fixtures, "probe", "dist"), path.join(fixtures, "other", "dist")].join(path.delimiter);
  const { app, page } = await launch(s, { claude: claudeScript }, undefined, { HH_PLUGIN_DIRS: dirs, HH_PLUGIN_FIXTURES: "1" });
  try {
    await page.getByRole("button", { name: "Start Demo" }).click();
    await expect(page.getByRole("tab", { name: "Probe panel" })).toBeVisible();
    const frame = page.frameLocator('iframe[title="Probe panel · Probe"]');

    // Round 1: every attempt blocked, the controls through. The panel waits on Continue until this round is read.
    await expect(frame.locator('body[data-round="1"][data-done="yes"]')).toHaveCount(1, { timeout: 90_000 });
    const expected = { ...Object.fromEntries(PROBES.map((n) => [n, "blocked"])), beacon: expect.stringMatching(/^(blocked|queued)$/) };
    expect(await panelOutcomes(frame)).toEqual({ round: "1", probes: expected, controls: { settings: "reached", stylesheet: "reached" } });
    await frame.getByRole("button", { name: "Continue" }).click();

    // The last step left the page; the app put the panel back on its own page (P3), which runs again and stays.
    await expect(frame.locator('body[data-round="2"][data-done="yes"]')).toHaveCount(1, { timeout: 90_000 });
    expect(await panelOutcomes(frame)).toEqual({ round: "2", probes: { ...expected, navigate: "blocked" }, controls: { settings: "reached", stylesheet: "reached" } });
    await expect(page.locator("iframe.hh-plugin-frame")).toHaveAttribute("src", "hh-plugin://probe/panel-probe.html");
    await expect(page.getByText("This panel kept reloading itself, so it was stopped.")).toHaveCount(0);
    // No frame of the window is anywhere but the app and the probe's panel page (nested frames start blank).
    const urls = page.frames().map((f) => f.url());
    expect(urls.filter((u) => u.startsWith("http"))).toEqual([]);
    expect(urls.filter((u) => u.startsWith("hh-plugin:"))).toEqual(["hh-plugin://probe/panel-probe.html"]);

    // Nothing reached the local server, late hits included.
    await page.waitForTimeout(2_000);
    expect(server.hits).toEqual([]);
  } finally {
    await closeAndClean(app, s);
    await server.close();
  }
});

test("mock mode: the demo's plugin, turned on, fills its panel from its fixtures", async () => {
  test.setTimeout(180_000);
  const s = makeSandbox("plugins-surface-mock");
  const { app, page } = await launchMock(s);
  try {
    await turnOnOnThisDay(page);
    await page.getByRole("button", { name: "Start Demo" }).click();
    const frame = otdFrame(page);
    await expect(frame.locator("tbody tr")).toHaveCount(25);
    await expect(frame.getByText("Sample event for the demo (fixture), 1901.")).toBeVisible();
    await expect(page.locator(".hh-pl-chip")).toContainText(`${roundYear().age}-year anniversary today`);
  } finally {
    await closeAndClean(app, s);
  }
});
