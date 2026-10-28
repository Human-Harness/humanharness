import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type ActionMatch, fakeClaudeCommand, loadRecordings } from "@humanharness/fake-agent";
import { type LoadedHarness, resolveInHarness } from "@humanharness/harness-sdk";
import { CliError } from "./cli";
import { briefMatch } from "./record";

/**
 * Every action by its brief's match, as `--record` writes it: the fake knows a task's action by it even with no
 * recording, so the default closing note is titled after the action. A brief that can't be read is left out.
 */
export async function actionMatches(harness: LoadedHarness): Promise<ActionMatch[]> {
  const out: ActionMatch[] = [];
  for (const [action, a] of Object.entries(harness.actions)) {
    const text = await Promise.resolve()
      .then(() => fs.readFile(resolveInHarness(harness, a.prompt), "utf8"))
      .catch(() => undefined);
    if (text !== undefined) out.push({ action, match: briefMatch(text, action) });
  }
  return out;
}

/** The env `dev --mock` adds (spec 3e §1): only HH_TEST_* for the shell, only HH_FAKE_* for the fake. */
export async function mockEnv(o: {
  harnessId: string;
  harnessDir: string;
  suggested: string;
  keep: boolean;
  tmpRoot?: string;
  /** The harness's actions by their brief's match (`actionMatches`). */
  actions?: ActionMatch[];
  out: { write(s: string): unknown };
}): Promise<Record<string, string>> {
  const mockDir = path.join(o.harnessDir, "mock");
  const { recordings, problems } = loadRecordings(mockDir);
  for (const p of problems) o.out.write(`mock: skipped ${p}\n`);
  if (recordings.length === 0) throw new CliError(`No recordings in ${mockDir}. Record one with: humanharness run <action> --record`);
  const root = path.join(o.tmpRoot ?? os.tmpdir(), `hh-mock-${o.harnessId}`);
  const userData = path.join(root, "userData");
  const sharedDir = path.join(root, "shared");
  try {
    if (!o.keep) await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(userData, { recursive: true });
    await fs.mkdir(sharedDir, { recursive: true });
  } catch (err) {
    throw new CliError(`Could not prepare ${root}: ${(err as Error).message}`);
  }
  o.out.write(`Mock mode: ${recordings.map((r) => r.action).join(", ")} recorded. Data in ${root}${o.keep ? " (kept)" : ""}.\n`);
  return {
    HH_TEST_MOCK: "1",
    // A time box in mock mode runs fast: a minute is a second (task-phases spec §6).
    HH_TEST_MINUTE_MS: "1000",
    HH_TEST_USER_DATA: userData,
    HH_TEST_SHARED_DIR: sharedDir,
    HH_TEST_SUGGESTED_FOLDER: path.join(root, path.basename(o.suggested)),
    HH_TEST_ENGINES: JSON.stringify({
      claude: {
        command: fakeClaudeCommand(),
        env: {
          HH_FAKE_MOCK_DIR: mockDir,
          HH_FAKE_MOCK_STATE: path.join(root, "mock-state.json"),
          ...(o.actions && o.actions.length > 0 ? { HH_FAKE_MOCK_ACTIONS: JSON.stringify(o.actions) } : {}),
        },
      },
    }),
  };
}
