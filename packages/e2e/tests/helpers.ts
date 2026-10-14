import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, type Page, _electron as electron } from "@playwright/test";
import { NOTICE_VERSION } from "@humanharness/engines";
import { type AcpScript, type ClaudeScript, fakeAcpCommand, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";

const here = path.dirname(fileURLToPath(import.meta.url));
export const shellDir = path.resolve(here, "../../shell");
/** The `electron` package exports the path of its binary. */
export const electronBinary = createRequire(path.join(shellDir, "package.json"))("electron") as string;

export interface Sandbox {
  root: string;
  /** The user's folder. */
  folder: string;
  userData: string;
  sharedDir: string;
  /** fake-claude appends {argv, prompt} for every run here. */
  claudePrompts: string;
  /** fake-acp appends every request it gets here. */
  acpLog: string;
}

/** A configured app (Spanish, Claude, plus `config`) with both engines' notices accepted, in packages/e2e/.tmp/. */
export function makeSandbox(name: string, config: Record<string, unknown> = {}): Sandbox {
  const root = path.resolve(here, "..", ".tmp", `${name}-${Date.now()}`);
  const s: Sandbox = {
    root,
    folder: path.join(root, "Work"),
    userData: path.join(root, "userData"),
    sharedDir: path.join(root, "shared"),
    claudePrompts: path.join(root, "claude-prompts.jsonl"),
    acpLog: path.join(root, "acp-log.jsonl"),
  };
  for (const dir of [s.folder, s.userData, s.sharedDir]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(s.userData, "config.json"), JSON.stringify({ language: "es", folder: s.folder, engineId: "claude", ...config }));
  const now = new Date().toISOString();
  const ready = { notice: { version: NOTICE_VERSION, acceptedAt: now }, verifiedAt: now };
  fs.writeFileSync(path.join(s.sharedDir, "engines.json"), JSON.stringify({ version: 1, engines: { claude: ready, codex: ready } }));
  return s;
}

/** A Codex that is never asked anything: keeps every engine fake, so no status check reaches a real CLI. */
const idleCodex: AcpScript = { turns: [] };

/** The environment of a launched shell: ours without the Electron dev variables, pointed at the sandbox. */
function baseEnv(s: Sandbox): Record<string, string> {
  // Not inherited: a dev server address, or ELECTRON_RUN_AS_NODE (it would start Electron as plain Node).
  const dropped = new Set(["ELECTRON_RENDERER_URL", "ELECTRON_RUN_AS_NODE"]);
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && !dropped.has(e[0])));
  return { ...env, HH_TEST_USER_DATA: s.userData, HH_TEST_SHARED_DIR: s.sharedDir };
}

/** Launches the built shell (or the build at `app`, a main/index.js) with the fake agents in place of both engines. */
export async function launch(
  s: Sandbox,
  scripts: { claude: ClaudeScript; codex?: AcpScript },
  app: string = shellDir,
): Promise<{ app: ElectronApplication; page: Page }> {
  const engines = {
    claude: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(s.root, scripts.claude), HH_FAKE_PROMPTS: s.claudePrompts } },
    codex: { command: fakeAcpCommand(), env: { HH_FAKE_SCRIPT: writeScript(s.root, scripts.codex ?? idleCodex), HH_FAKE_LOG: s.acpLog } },
  };
  const electronApp = await electron.launch({
    executablePath: electronBinary,
    args: [app],
    env: { ...baseEnv(s), HH_TEST_ENGINES: JSON.stringify(engines) },
  });
  return { app: electronApp, page: await electronApp.firstWindow() };
}

/** The demo's recordings (harnesses/demo/mock). */
export const demoMockDir = path.resolve(here, "../../../harnesses/demo/mock");

/** Launches the built shell in mock mode (spec 3e): fake-claude replays `mockDir`; Codex isn't offered. */
export async function launchMock(s: Sandbox, mockDir: string = demoMockDir): Promise<{ app: ElectronApplication; page: Page }> {
  const engines = { claude: { command: fakeClaudeCommand(), env: { HH_FAKE_MOCK_DIR: mockDir, HH_FAKE_MOCK_STATE: path.join(s.root, "mock-state.json") } } };
  const electronApp = await electron.launch({
    executablePath: electronBinary,
    args: [shellDir],
    env: { ...baseEnv(s), HH_TEST_ENGINES: JSON.stringify(engines), HH_TEST_MOCK: "1" },
  });
  return { app: electronApp, page: await electronApp.firstWindow() };
}

/** Closes the app and removes the sandbox: .tmp sits inside the repository the explainer reads. */
export async function closeAndClean(app: ElectronApplication, s: Sandbox): Promise<void> {
  try {
    await app.close();
  } finally {
    fs.rmSync(s.root, { recursive: true, force: true });
  }
}

export function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
}

/** The session a fake-claude run used (`--session-id` for a new one, `--resume` to continue). */
export function sessionOf(argv: string[]): string {
  const flag = argv.includes("--resume") ? "--resume" : "--session-id";
  return argv[argv.indexOf(flag) + 1];
}

/** The --model, --effort and --autocompact values of a fake-claude run (undefined when a flag is absent). */
export function profileFlags(argv: string[]): (string | undefined)[] {
  return ["--model", "--effort", "--autocompact"].map((flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined));
}

export const usageFile = (s: Sandbox) => path.join(s.folder, ".harness", "usage.jsonl");
