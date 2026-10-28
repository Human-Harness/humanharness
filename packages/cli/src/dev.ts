import { type SpawnOptions, spawn } from "node:child_process";
import path from "node:path";
import type { Writable } from "node:stream";
import { availableEngines } from "@humanharness/engines";
import { checkHarness, formatFindings } from "./check";
import { CliError, type Io, UsageError, parseCommand } from "./cli";
import { actionMatches, mockEnv } from "./mock-session";
import { shellDir } from "./paths";

/** The part of child_process.spawn `dev` uses (tests replace it). */
export type DevSpawn = (command: string, args: string[], options: SpawnOptions) => { on(event: "exit", listener: (code: number | null) => void): unknown; on(event: "error", listener: (err: Error) => void): unknown };

export interface DevOptions {
  harnessDir: string;
  /** Preselects this engine in a fresh app (HH_DEV_ENGINE). */
  engine?: string;
  /** Builds the app into this folder instead of opening it (HH_OUT_DIR; the end-to-end test). */
  build?: string;
  /** Open the app with the fake engine replaying mock/ (spec 3e). */
  mock?: boolean;
  /** With mock: reuse the previous mock session's folders. */
  keep?: boolean;
  /** Where the mock session folders go (default: the OS temp folder; tests). */
  tmpRoot?: string;
  out: Writable;
  spawn?: DevSpawn;
}

/** `check`, then the shell's electron-vite with HH_HARNESS_DIR: the mechanism `corepack pnpm app:dev` uses for the demo. */
export async function devCommand(o: DevOptions): Promise<number> {
  if (o.keep && !o.mock) throw new UsageError("--keep only works with --mock");
  if (o.mock && o.engine && o.engine !== "claude") throw new UsageError("Mock mode replays as Claude; drop --engine or use --engine claude.");
  const root = path.resolve(o.harnessDir);
  const checked = await checkHarness(root);
  const harness = checked.harness;
  // A broken recording only stops the app that replays it: without --mock it is a warning.
  const findings = o.mock ? checked.findings : checked.findings.map((f) => (f.rule.startsWith("mock-") ? { ...f, severity: "warning" as const } : f));
  if (findings.length > 0) o.out.write(formatFindings(findings));
  if (!harness || findings.some((f) => f.severity === "error")) {
    o.out.write("Fix the errors above before opening the app.\n");
    return 1;
  }
  if (o.engine && !availableEngines(harness.engines, "development").some((e) => e.id === o.engine)) {
    throw new UsageError(`Engine "${o.engine}" is not available for ${harness.id}.`);
  }
  if (o.mock && !availableEngines(harness.engines, "development").some((e) => e.id === "claude")) {
    throw new UsageError(`Mock mode replays as Claude, which ${harness.id} doesn't offer.`);
  }
  const shell = shellDir();
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: root };
  // Electron started as plain Node would not open a window.
  delete env.ELECTRON_RUN_AS_NODE;
  // A developer's stray test, fake-engine or engine settings must not leak into the app.
  for (const k of Object.keys(env)) if (k.startsWith("HH_TEST_") || k.startsWith("HH_FAKE_") || k === "HH_DEV_ENGINE") delete env[k];
  if (o.mock) {
    try {
      const actions = await actionMatches(harness);
      Object.assign(env, await mockEnv({ harnessId: harness.id, harnessDir: root, suggested: harness.folder.suggested, keep: o.keep === true, tmpRoot: o.tmpRoot, actions, out: o.out }));
    } catch (err) {
      if (!(err instanceof CliError)) throw err;
      o.out.write(`${err.message}\n`);
      return 1;
    }
  }
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
  const { values, positionals } = parseCommand(args, { engine: { type: "string" }, build: { type: "string" }, mock: { type: "boolean" }, keep: { type: "boolean" }, harness: { type: "string" } });
  if (positionals.length > 0) throw new UsageError("Usage: humanharness dev [--engine <id>] [--mock [--keep]] [--build <dir>] [--harness <dir>]");
  return devCommand({
    harnessDir: path.resolve(io.cwd, values.harness ?? "."),
    ...(values.engine ? { engine: values.engine } : {}),
    ...(values.build ? { build: path.resolve(io.cwd, values.build) } : {}),
    ...(values.mock ? { mock: true } : {}),
    ...(values.keep ? { keep: true } : {}),
    out: io.stdout,
  });
}
