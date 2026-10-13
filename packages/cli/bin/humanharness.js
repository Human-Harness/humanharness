#!/usr/bin/env node
// The `humanharness` command. The core ships TypeScript source: tsx loads it, and also loads the harness's TypeScript manifest.
import { register } from "tsx/esm/api";

register();
const { main } = await import("../src/main.ts");
process.exitCode = await main(process.argv.slice(2), { cwd: process.cwd(), stdin: process.stdin, stdout: process.stdout, stderr: process.stderr });
