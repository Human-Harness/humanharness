import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Every test run gets its own temp folder, removed when the run ends. Tests and the code under test make temp folders
 * with os.tmpdir(); the ones a test forgets used to pile up in the system temp folder (hundreds of thousands of
 * entries), and esbuild lists each parent folder when it resolves, so every tool and plugin build got ~1 s slower.
 * Workers inherit TMPDIR, so os.tmpdir() points here everywhere.
 */
export default function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-vitest-"));
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = dir;
  return () => {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  };
}
