import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakeClaudeCommand, loadRecordings } from "@humanharness/fake-agent";
import { CliError } from "./cli";

/** The env `dev --mock` adds (spec 3e §1): only HH_TEST_* for the shell, only HH_FAKE_* for the fake. */
export async function mockEnv(o: { harnessId: string; harnessDir: string; suggested: string; keep: boolean; tmpRoot?: string; out: { write(s: string): unknown } }): Promise<Record<string, string>> {
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
    HH_TEST_USER_DATA: userData,
    HH_TEST_SHARED_DIR: sharedDir,
    HH_TEST_SUGGESTED_FOLDER: path.join(root, path.basename(o.suggested)),
    HH_TEST_ENGINES: JSON.stringify({
      claude: { command: fakeClaudeCommand(), env: { HH_FAKE_MOCK_DIR: mockDir, HH_FAKE_MOCK_STATE: path.join(root, "mock-state.json") } },
    }),
  };
}
