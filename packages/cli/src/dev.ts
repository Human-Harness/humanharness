import { type SpawnOptions, spawn } from "node:child_process";
import path from "node:path";
import type { Writable } from "node:stream";
import { availableEngines } from "@humanharness/engines";
import { checkHarness, formatFindings } from "./check";
import { type Io, UsageError, parseCommand } from "./cli";
import { shellDir } from "./paths";

/** The part of child_process.spawn `dev` uses (tests replace it). */
export type DevSpawn = (command: string, args: string[], options: SpawnOptions) => { on(event: "exit", listener: (code: number | null) => void): unknown; on(event: "error", listener: (err: Error) => void): unknown };

export interface DevOptions {
  harnessDir: string;
  /** Preselects this engine in a fresh app (HH_DEV_ENGINE). */
  engine?: string;
  /** Builds the app into this folder instead of opening it (HH_OUT_DIR; the end-to-end test). */
  build?: string;
  out: Writable;
  spawn?: DevSpawn;
}

/** `check`, then the shell's electron-vite with HH_HARNESS_DIR: the mechanism `corepack pnpm app:dev` uses for the demo. */
export async function devCommand(o: DevOptions): Promise<number> {
  const root = path.resolve(o.harnessDir);
  const { findings, harness } = await checkHarness(root);
  if (findings.length > 0) o.out.write(formatFindings(findings));
  if (!harness || findings.some((f) => f.severity === "error")) {
    o.out.write("Fix the errors above before opening the app.\n");
    return 1;
  }
  if (o.engine && !availableEngines(harness.engines, "development").some((e) => e.id === o.engine)) {
    throw new UsageError(`Engine "${o.engine}" is not available for ${harness.id}.`);
  }
  const shell = shellDir();
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: root };
  // Electron started as plain Node would not open a window.
  delete env.ELECTRON_RUN_AS_NODE;
  if (o.engine) env.HH_DEV_ENGINE = o.engine;
  if (o.build) env.HH_OUT_DIR = path.resolve(o.build);
  const child = (o.spawn ?? (spawn as unknown as DevSpawn))(path.join(shell, "node_modules", ".bin", "electron-vite"), [o.build ? "build" : "dev"], {
    cwd: shell,
    env,
    stdio: "inherit",
  });
  return new Promise((resolve) => {
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", (err) => {
      o.out.write(`Could not start electron-vite: ${err.message}\n`);
      resolve(1);
    });
  });
}

export async function devCommandLine(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseCommand(args, { engine: { type: "string" }, build: { type: "string" }, harness: { type: "string" } });
  if (positionals.length > 0) throw new UsageError("Usage: humanharness dev [--engine <id>] [--build <dir>] [--harness <dir>]");
  return devCommand({
    harnessDir: path.resolve(io.cwd, values.harness ?? "."),
    ...(values.engine ? { engine: values.engine } : {}),
    ...(values.build ? { build: path.resolve(io.cwd, values.build) } : {}),
    out: io.stdout,
  });
}
