#!/usr/bin/env node
// The `humanharness` command. The core ships TypeScript source: tsx loads it, and also loads the harness's TypeScript manifest.
import { register } from "tsx/esm/api";

register();
const { exitsWhenDone, main } = await import("../src/main.ts");
const argv = process.argv.slice(2);
process.exitCode = await main(argv, { cwd: process.cwd(), stdin: process.stdin, stdout: process.stdout, stderr: process.stderr });
if (exitsWhenDone(argv)) {
  // Once what was printed has been written out (a pipe on macOS writes later).
  await Promise.all([process.stdout, process.stderr].map((s) => new Promise((r) => s.write("", r))));
  process.exit();
}
