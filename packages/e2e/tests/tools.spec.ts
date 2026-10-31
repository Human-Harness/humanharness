import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, type Page, expect, test } from "@playwright/test";
import { type ClaudeScript, callMcpTool, claudeTextLines } from "@humanharness/fake-agent";
import { type Sandbox, closeAndClean, launch, makeSandbox, readJsonl, shellDir } from "./helpers";

// Harness tools, slice 2 (tools spec §4, §5, §8.2, §9): the fixture's committed dist/ (packages/cli/test/fixture-dist.test.ts
// keeps it fresh) runs in the sandbox window. The agent's calls show as folded lines in the task's chat; a refused
// access shows unfolded; the sandbox has no Node; an agent: "none" tool is never offered to the agent; Test connection
// runs the connect step's tool. Fake-claude and the test crypto (HH_TEST_FAKE_SECRETS=1) only: no network, no Keychain.
// D0: a harness without tools has no tools window, partition handler or rpc channel.

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, "../../fake-agent/fixtures/tools-harness");
/**
 * Built straight into out/tools: main finds the tool host's page, script and preload through the build's
 * `__SHELL_RESOURCES__`, never `<main>/../../resources` (here out/resources, which no build writes).
 */
const out = path.join(shellDir, "out", "tools");
const HARNESS_ID = "toolbox";
const NOTE = "a private line the peek must never show";
const TOKEN = "tok-tools-e2e-987654321";
const REPLY = "Conté tus notas.";

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
const tool = (name: string) => ({ mcp: { server: "tools", tool: name, args: {} } });
/** The task's one turn: three agent tools, then the agent: "none" one (the server answers it, never the app). */
const script: ClaudeScript = { steps: [tool("count-notes"), tool("peek-folder"), tool("probe"), tool("hidden"), ...claudeTextLines(REPLY), result] };

type Run = { argv: string[]; prompt: string };
type McpServer = { command: string; args?: string[]; env?: Record<string, string> };
type Access = { kind: string; target: string; allowed: boolean };
type Trace = { tool: string; caller: string; ok: boolean; error?: string; accesses: Access[]; task?: string };

let s: Sandbox;
let app: ElectronApplication | undefined;
let page: Page;

/** Every file under `dir` (absolute), skipping none. */
function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.isFile() ? [p] : [];
  });
}

/** The trace entries under `.harness/trace/<sub>`. */
const traceOf = (sub: string): Trace[] => walk(path.join(s.folder, ".harness", "trace", sub)).filter((f) => f.endsWith(".jsonl")).flatMap((f) => readJsonl<Trace>(f));

/** The `tools` server the app gave the agent's first run (its --mcp-config). */
function toolsServer(): McpServer {
  const [run] = readJsonl<Run>(s.claudePrompts);
  const config = JSON.parse(run.argv[run.argv.indexOf("--mcp-config") + 1]) as { mcpServers: Record<string, McpServer> };
  return config.mcpServers.tools;
}

const line = (name: string) => page.locator(".hh-tool-call").filter({ has: page.getByRole("button", { name: new RegExp(`^${name} `) }) });

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  // electron-vite directly (as connections.spec): `humanharness dev --build` would first run `check`.
  test.setTimeout(600_000);
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: out };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
  s = makeSandbox("tools");
  // The person's folder: notes the counting tool reads, and the one file the peek may not.
  fs.writeFileSync(path.join(s.folder, "notes.md"), `${NOTE}\n`);
  for (const f of ["notes/a.md", "notes/b.md", "ideas/c.md"]) {
    fs.mkdirSync(path.dirname(path.join(s.folder, f)), { recursive: true });
    fs.writeFileSync(path.join(s.folder, f), `# ${f}\n`);
  }
  const launched = await launch(s, { claude: script }, path.join(out, "main", "index.js"), { HH_TEST_FAKE_SECRETS: "1", HH_TEST_MOCK: "1" });
  app = launched.app;
  page = launched.page;
});

test.afterAll(async () => {
  try {
    if (app) await closeAndClean(app, s);
    else if (s) fs.rmSync(s.root, { recursive: true, force: true });
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("an agent call shows as a folded line in the chat, and unfolds to its arguments, result and accesses", async () => {
  await page.getByRole("button", { name: "Start Toolbox" }).click();
  await page.getByRole("button", { name: /Survey/ }).first().click();
  await expect(page.getByRole("main").getByText(REPLY)).toBeVisible({ timeout: 30_000 });

  const count = line("count-notes");
  const button = count.getByRole("button");
  // "<id> · <summary> · <s> s · 0 tokens" (Decision 10): three folders, so three items.
  await expect(button).toHaveText(/^count-notes · 3 items · \d+\.\d s · 0 tokens$/);
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(count.locator("dl")).toBeHidden();

  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const details = count.locator("dl");
  await expect(details.getByRole("term")).toHaveText(["Arguments", "Result", "Accesses"]);
  await expect(details.locator("pre").first()).toHaveText("{}");
  // The top level holds notes.md and the files the app writes there (the agent's instructions).
  await expect(details.locator("pre").nth(1)).toContainText('{"folder":".","notes":');
  await expect(details.locator("pre").nth(1)).toContainText('{"folder":"notes","notes":2}');
  await expect(details.locator("pre").nth(1)).toContainText('{"folder":"ideas","notes":1}');
  await expect(details.getByRole("listitem")).toHaveCount(1);
  await expect(details.getByRole("listitem").first()).toHaveText(/^files /);
  await expect(details).not.toContainText("access denied");

  // The trace keeps the same call for the task, as the agent's (tools spec §8.1).
  const entries = traceOf("").filter((e) => e.task !== undefined);
  expect(entries.map((e) => [e.tool, e.caller, e.ok])).toEqual([
    ["count-notes", "agent", true],
    ["peek-folder", "agent", false],
    ["probe", "agent", true],
  ]);
});

test("a refused access shows unfolded", async () => {
  const peek = line("peek-folder");
  const button = peek.getByRole("button");
  // A failed call starts open, without a click.
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(button).toHaveText(/^peek-folder failed · /);
  await expect(peek).toHaveClass(/hh-error/);
  await expect(peek.getByRole("listitem")).toHaveText(["files notes.md · access denied"]);
  // No result, and never the file's text.
  await expect(peek.getByRole("term")).toHaveText(["Arguments", "Accesses"]);
  await expect(page.locator("body")).not.toContainText(NOTE);
  expect(await page.content()).not.toContain(NOTE);
});

test("the sandbox has no Node", async () => {
  const probe = line("probe");
  const button = probe.getByRole("button");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await button.click();
  const shown = probe.locator("pre").nth(1);
  await expect(shown).toContainText('"require":"undefined"');
  await expect(shown).toContainText('"process":"undefined"');
});

test("an agent: none tool is not offered to the agent", async () => {
  // What the server lists: the catalogue the app wrote for it holds only the agent: "call" tools.
  const server = toolsServer();
  const catalogue = JSON.parse(fs.readFileSync(server.env!.HH_TOOLS, "utf8")) as { name: string }[];
  expect(catalogue.map((t) => t.name).sort()).toEqual(["count-notes", "peek-folder", "probe"]);
  // The script's call of `hidden` got an error from the server and never reached the app: no line, no trace entry.
  await expect(line("hidden")).toHaveCount(0);
  expect(traceOf("").some((e) => e.tool === "hidden")).toBe(false);
  // Asked again through the same server the agent has: an error naming no tool, for both agent: "none" tools.
  for (const name of ["hidden", "check-key"]) {
    const answer = (await callMcpTool({ command: server.command, args: server.args ?? [], env: server.env ?? {} }, name, {})) as {
      isError?: boolean;
      content: { type: string; text: string }[];
    };
    expect(answer.isError).toBe(true);
    expect(answer.content[0].text).toBe(`No tool "${name}"`);
  }
  expect(traceOf("").some((e) => e.tool === "hidden" || e.tool === "check-key")).toBe(false);
});

test("the saved chat keeps the calls", async () => {
  const chats = () => walk(path.join(s.folder, ".harness", "chats")).filter((f) => f.endsWith(".jsonl"));
  const saved = () =>
    chats()
      .flatMap((f) => readJsonl<{ tools?: { tool: string; ok: boolean }[] }>(f))
      .flatMap((e) => e.tools ?? [])
      .map((c) => [c.tool, c.ok]);
  await expect.poll(saved).toEqual([
    ["count-notes", true],
    ["peek-folder", false],
    ["probe", true],
  ]);
  expect(chats().map((f) => fs.readFileSync(f, "utf8")).join("\n")).not.toContain(NOTE);
  // Saved on the reply: the one entry carrying them is the assistant's answer of that turn.
  const carriers = chats()
    .flatMap((f) => readJsonl<{ role?: string; text?: string; tools?: unknown[] }>(f))
    .filter((e) => e.tools !== undefined);
  expect(carriers.map((e) => [e.role, e.text])).toEqual([["assistant", REPLY]]);

  // Saved on the reply: after the window reloads (Home), reopening reopens the task, whose chat draws them again from
  // the log (the refused one open).
  await page.reload();
  await page.getByRole("button", { name: "Start Toolbox" }).click();
  await expect(page.getByRole("main").getByText(REPLY)).toBeVisible();
  await expect(line("count-notes").getByRole("button")).toHaveText(/^count-notes · 3 items · \d+\.\d s · 0 tokens$/);
  await expect(line("count-notes").getByRole("button")).toHaveAttribute("aria-expanded", "false");
  await expect(line("peek-folder").getByRole("button")).toHaveAttribute("aria-expanded", "true");
  await expect(line("peek-folder").getByRole("listitem")).toHaveText(["files notes.md · access denied"]);
  await expect(line("probe")).toHaveCount(1);
  // Reopening ran no new turn.
  expect(readJsonl<Run>(s.claudePrompts)).toHaveLength(1);
});

test("Test connection without a key says 'Demo key is not set — Settings › Connections'", async () => {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("tab", { name: "Connections" }).click();
  const key = page.getByRole("tabpanel").getByRole("group", { name: "Demo key" });
  await expect(key.getByText("Not set · paste the key to use it", { exact: true })).toBeVisible();
  await key.getByRole("button", { name: "Test connection" }).click();
  await expect(key.getByRole("status")).toHaveText("Didn't work: Demo key is not set — Settings › Connections");

  // It failed before any request: the UI call's trace entry reaches nothing, so api.example.invalid was never asked.
  const ui = traceOf("ui");
  expect(ui.map((e) => [e.tool, e.caller, e.ok, e.error])).toEqual([["check-key", "ui", false, "Demo key is not set — Settings › Connections"]]);
  expect(ui[0].accesses).toEqual([]);
  // The kept result: no value, the same message.
  const kept = JSON.parse(fs.readFileSync(path.join(s.sharedDir, HARNESS_ID, "connections.json"), "utf8")) as { tests: Record<string, { ok: boolean; message?: string }> };
  expect(kept.tests.demo).toMatchObject({ ok: false, message: "Demo key is not set — Settings › Connections" });
});

test("no key value or header appears in the page, the chat log or the trace", async () => {
  const key = page.getByRole("tabpanel").getByRole("group", { name: "Demo key" });
  const field = key.getByPlaceholder("Paste the key");
  await field.fill(TOKEN);
  await key.getByRole("button", { name: "Save" }).click();
  await expect(field).toHaveValue("");
  await expect(key.getByText("Set", { exact: true })).toBeVisible();
  // Saved, not tested again: Test is never pressed with a key, so nothing goes out.

  expect(await page.content()).not.toContain(TOKEN);
  expect(await page.evaluate(() => document.documentElement.outerHTML)).not.toContain(TOKEN);
  expect(await page.content()).not.toMatch(/Bearer|authorization|\{\{secret:/i);
  // Every file the app wrote (the folder's chats and trace, userData, the shared folder): never the value, never the
  // header, never the host.
  const written = [s.folder, s.userData, s.sharedDir].flatMap(walk).filter((f) => fs.statSync(f).size < 8_000_000);
  expect(written.some((f) => f.includes(path.join(".harness", "trace")))).toBe(true);
  for (const f of written) {
    const text = fs.readFileSync(f).toString("latin1");
    expect(text.includes(TOKEN), f).toBe(false);
    if (f.startsWith(s.folder)) expect(/Bearer|api\.example\.invalid/.test(text), f).toBe(false);
    // The refused peek never carried notes.md's text anywhere (the trace, the chat): only the note itself holds it.
    if (f.startsWith(s.folder) && f !== path.join(s.folder, "notes.md")) expect(text.includes(NOTE), f).toBe(false);
  }
  await page.getByRole("button", { name: "Done", exact: true }).click();
});

test("the tools window, its partition handler and its rpc channel exist with tools (the D0 control)", async () => {
  expect(await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2);
  expect(await app!.evaluate(({ session }, id) => session.fromPartition(`hh-tools-${id}`).protocol.isProtocolHandled("hh-tools"), HARNESS_ID)).toBe(true);
  expect(await app!.evaluate(({ ipcMain }) => {
    try {
      ipcMain.handle("hh-tools:rpc", () => null);
      return "free";
    } catch {
      return "taken";
    }
  })).toBe("taken");
  await expect(page.getByText("Tools are off after repeated crashes")).toHaveCount(0);
});

test("D0: a harness without tools has no hh-tools handler", async () => {
  // The demo build (corepack pnpm app:build): no tools declared.
  test.setTimeout(180_000);
  const d0 = makeSandbox("tools-d0");
  const plain: ClaudeScript = { steps: [...claudeTextLines("Una pregunta corta."), result] };
  const launched = await launch(d0, { claude: plain });
  try {
    const a = launched.app;
    await expect(launched.page.getByRole("button", { name: "Start Demo" })).toBeVisible();
    expect(await a.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    expect(await a.evaluate(({ session }) => session.defaultSession.protocol.isProtocolHandled("hh-tools"))).toBe(false);
    expect(await a.evaluate(({ session }) => session.fromPartition("hh-tools-demo").protocol.isProtocolHandled("hh-tools"))).toBe(false);
    // No handler on the tools channel: registering one succeeds (and is removed again).
    expect(await a.evaluate(({ ipcMain }) => {
      try {
        ipcMain.handle("hh-tools:rpc", () => null);
        ipcMain.removeHandler("hh-tools:rpc");
        return "free";
      } catch {
        return "taken";
      }
    })).toBe("free");
    // A turn runs: the agent gets no `tools` server, and nothing is traced or catalogued.
    await launched.page.getByRole("button", { name: "Start Demo" }).click();
    await launched.page.getByRole("region", { name: "Which part do you want to understand?" }).getByRole("button", { name: /The manifest/ }).click();
    await expect(launched.page.getByRole("main").getByText("Una pregunta corta.")).toBeVisible({ timeout: 30_000 });
    const runs = readJsonl<Run>(d0.claudePrompts);
    expect(runs).toHaveLength(1);
    const at = runs[0].argv.indexOf("--mcp-config");
    expect(at).toBeGreaterThan(-1);
    const servers = (JSON.parse(runs[0].argv[at + 1]) as { mcpServers: Record<string, McpServer> }).mcpServers;
    expect(Object.keys(servers).length).toBeGreaterThan(0);
    expect(Object.keys(servers)).not.toContain("tools");
    expect(fs.existsSync(path.join(d0.folder, ".harness", "trace"))).toBe(false);
    expect(fs.existsSync(path.join(d0.userData, "tools-catalogue"))).toBe(false);
  } finally {
    await closeAndClean(launched.app, d0);
  }
});
