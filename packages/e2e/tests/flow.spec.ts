import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { closeAndClean, electronBinary, launch, makeSandbox, profileFlags, readJsonl, sessionOf, shellDir, usageFile } from "./helpers";
import { claudeScript, codexScript } from "./scripts";

type Run = { argv: string[]; prompt: string };
const START = "Which part do you want to understand?";
const readTasks = (folder: string) => JSON.parse(fs.readFileSync(path.join(folder, ".harness", "tasks.json"), "utf8"));

test("a topic answered with blocks, then next: the note is saved and the next topic starts from it", async () => {
  const s = makeSandbox("flow");
  const { app, page } = await launch(s, { claude: claudeScript });
  try {
    await page.getByRole("button", { name: "Start Demo" }).click();
    await page.getByRole("region", { name: START }).getByRole("button", { name: /The manifest/ }).click();
    await expect(page.getByRole("main").getByText("El manifiesto declara todo el harness.")).toBeVisible();
    await expect(page.getByRole("figure", { name: "Del manifiesto a la app" })).toBeVisible();
    // Source files are shown in Finder, never opened.
    await expect(page.getByRole("button", { name: "Show packages/harness-sdk/src/index.ts in Finder" })).toBeVisible();

    await page.getByRole("button", { name: "Seguir el recorrido →" }).click();
    await expect(page.getByRole("main").getByText("Los motores se detectan en cada inicio.")).toBeVisible();

    const note = fs.readFileSync(path.join(s.folder, ".harness", "notes", "manifest.md"), "utf8");
    expect(note).toContain('title: "El manifiesto"');
    expect(note).toContain("- defineHarness valida el manifiesto");
    // Spec D2: a harness with neither scopes nor data keeps today's layout, chat, usage lines and MCP servers.
    expect(fs.existsSync(path.join(s.folder, ".harness", "scopes.json"))).toBe(false);
    expect(fs.existsSync(path.join(s.folder, ".harness", "data"))).toBe(false);
    expect(fs.readdirSync(path.join(s.folder, ".harness", "notes")).every((f) => f.endsWith(".md"))).toBe(true);
    expect(fs.readdirSync(path.join(s.folder, ".harness", "chats")).filter((f) => f.endsWith(".jsonl"))).toEqual(["main.jsonl"]);

    const [first, close, second] = readJsonl<Run>(s.claudePrompts);
    expect(first.prompt).toContain("# Topic: the manifest");
    expect(first.prompt).not.toContain("## What we already covered");
    expect(close.prompt).toContain("save_note");
    expect(close.argv).toContain("--resume");
    expect(sessionOf(close.argv)).toBe(sessionOf(first.argv));
    expect(second.prompt).toContain("# Topic: engines");
    expect(second.prompt).toContain(
      "- El manifiesto (manifest): defineHarness valida el manifiesto; Las acciones traen su brief → .harness/notes/manifest.md",
    );
    expect(second.argv).toContain("--session-id");
    expect(sessionOf(second.argv)).not.toBe(sessionOf(first.argv));
    // Spec §5.2: the manifest topic is standard → sonnet, medium effort, a 200k cap, on every call of the task.
    for (const run of [first, close, second]) expect(profileFlags(run.argv)).toEqual(["sonnet", "medium", "200000"]);
    await expect.poll(() => readJsonl<Record<string, unknown>>(usageFile(s))[0]).toMatchObject({ action: "manifest", tier: "standard", model: "sonnet", effort: "medium", cap: 200_000 });

    // The text shows before the turn ends: wait for its usage line and the task's state.
    await expect.poll(() => readTasks(s.folder)).toMatchObject({ current: { action: "engines", status: "waiting" }, actions: { manifest: "done" } });
    await expect.poll(() => readJsonl<{ phase?: string }>(usageFile(s)).map((r) => r.phase)).toEqual(["run", "close", "run"]);
    expect(readJsonl<Record<string, unknown>>(usageFile(s)).some((r) => "scope" in r)).toBe(false);
    expect(Object.keys(readTasks(s.folder))).not.toContain("open");
    const servers = Object.keys((JSON.parse(first.argv[first.argv.indexOf("--mcp-config") + 1]) as { mcpServers: object }).mcpServers);
    expect(servers).not.toContain("data");
    // Input blocks D0: the demo declares none, so nothing of them shows anywhere.
    const agents = fs.readFileSync(path.join(s.folder, "AGENTS.md"), "utf8");
    expect(agents).not.toContain("### Answers from input blocks");
    expect(agents).not.toContain("show_annotate");
    // Harness settings D0: the demo declares none, so AGENTS.md has no settings section and nothing is stored.
    expect(agents).not.toContain("### How to work with this person");
    // Task modes D0: the demo declares none, so there is no recommend_mode tool, no mode bar and no mode anywhere.
    expect(agents).not.toContain("show_recommend_mode");
    await expect(page.getByRole("button", { name: "Change mode" })).toHaveCount(0);
    expect(readTasks(s.folder).current).not.toHaveProperty("mode");
    expect(readJsonl<Record<string, unknown>>(usageFile(s)).some((r) => "mode" in r)).toBe(false);
    expect(close.prompt).not.toContain("modes used");
    const state = await page.evaluate(() => (window as unknown as { hh: { getState: () => Promise<Record<string, unknown>> } }).hh.getState());
    expect(state).not.toHaveProperty("modes");
    for (const action of Object.values(state.actions as Record<string, object>)) {
      expect(action).not.toHaveProperty("modes");
      expect(action).not.toHaveProperty("defaultMode");
    }
    expect(fs.existsSync(path.join(s.folder, ".harness", "data", "_app", "settings.json"))).toBe(false);
    expect(readTasks(s.folder).current).not.toHaveProperty("pendingInput");
    const chatLines = readJsonl<{ blocks?: Record<string, unknown>[] }>(path.join(s.folder, ".harness", "chats", "main.jsonl"));
    const shownBlocks = chatLines.flatMap((e) => e.blocks ?? []);
    expect(shownBlocks.length).toBeGreaterThan(0);
    expect(shownBlocks.every((b) => !("id" in b) && !("input" in b))).toBe(true);
    await expect(page.getByRole("list", { name: "What's clear so far" }).getByRole("button", { name: "El manifiesto" })).toBeVisible();

    // Settings › Uso: the manifest task took the five-hour window from 10 % to 14 % (spec 3b).
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("tab")).toHaveText(["General", "Engine", "Models", "Usage"]);
    await page.getByRole("tab", { name: "Usage" }).click();
    const usage = page.getByRole("tabpanel", { name: "Usage" });
    await expect(usage.getByText("15% used")).toBeVisible();
    const manifest = usage.getByRole("row", { name: /The manifest/ });
    await expect(manifest.getByRole("cell")).toHaveText(["≈ 4% of 5 h", "about 25 times"]);
  } finally {
    await closeAndClean(app, s);
  }
});

test("changing the engine keeps the notes, and the first task on the new engine starts from them", async () => {
  const s = makeSandbox("switch");
  const { app, page } = await launch(s, { claude: claudeScript, codex: codexScript });
  try {
    await page.getByRole("button", { name: "Start Demo" }).click();
    await page.getByRole("region", { name: START }).getByRole("button", { name: /The manifest/ }).click();
    await expect(page.getByRole("main").getByText("El manifiesto declara todo el harness.")).toBeVisible();
    await page.getByRole("button", { name: "Seguir el recorrido →" }).click();
    await expect(page.getByRole("main").getByText("Los motores se detectan en cada inicio.")).toBeVisible();
    // The text shows before the turn ends, and the engine can't change while a turn runs.
    await expect.poll(() => readTasks(s.folder).current?.status).toBe("waiting");

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "Engine" }).click();
    await page.getByRole("button", { name: /Codex/ }).first().click();
    await page.getByRole("button", { name: "Use Codex" }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await expect(page.getByRole("main").getByText(/You're now using Codex/)).toBeVisible();
    await expect(page.getByRole("list", { name: "What's clear so far" }).getByRole("button", { name: "El manifiesto" })).toBeVisible();
    expect(fs.existsSync(path.join(s.folder, ".harness", "notes", "manifest.md"))).toBe(true);
    await expect.poll(() => readTasks(s.folder)).toMatchObject({ current: null, actions: { manifest: "done", engines: "unfinished" } });

    await page.getByPlaceholder("Or ask something…").fill("¿Dónde se guarda la conversación?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("main").getByText("Se guarda en .harness/chats.")).toBeVisible();
    const prompt = readJsonl<{ method: string; params: { prompt: { text: string }[] } }>(s.acpLog).find((l) => l.method === "session/prompt");
    expect(prompt?.params.prompt[0].text).toContain("## Question\n¿Dónde se guarda la conversación?");
    expect(prompt?.params.prompt[0].text).toContain(
      "- El manifiesto (manifest): defineHarness valida el manifiesto; Las acciones traen su brief → .harness/notes/manifest.md",
    );
    // Free questions are light; Codex runs its default model, so CODEX_CONFIG has no model.
    const env = readJsonl<{ method: string; params: { CODEX_CONFIG: string | null } }>(s.acpLog).find((l) => l.method === "env");
    expect(JSON.parse(env!.params.CODEX_CONFIG!)).toEqual({ model_reasoning_effort: "low", model_auto_compact_token_limit: 100_000 });
    // The models Codex offered are saved for Settings › Modelos.
    await expect
      .poll(() => JSON.parse(fs.readFileSync(path.join(s.sharedDir, "engines.json"), "utf8")).engines.codex.models)
      .toEqual([{ id: "gpt-5.5", name: "GPT-5.5" }]);
  } finally {
    await closeAndClean(app, s);
  }
});

test("a second start with the same app data quits and leaves the running app alone", async () => {
  const s = makeSandbox("single");
  const { app, page } = await launch(s, { claude: claudeScript });
  try {
    await expect(page.getByRole("button", { name: "Start Demo" })).toBeVisible();
    const dropped = new Set(["ELECTRON_RENDERER_URL", "ELECTRON_RUN_AS_NODE"]);
    const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && !dropped.has(e[0])));
    const second = spawn(electronBinary, [shellDir], { env: { ...env, HH_TEST_USER_DATA: s.userData, HH_TEST_SHARED_DIR: s.sharedDir }, stdio: "ignore" });
    const exited = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 20_000);
      second.on("exit", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    if (!exited) second.kill();
    expect(exited).toBe(true);
    await expect(page.getByRole("button", { name: "Start Demo" })).toBeVisible();
  } finally {
    await closeAndClean(app, s);
  }
});
