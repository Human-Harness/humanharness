import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Writable } from "node:stream";
import { hasTools } from "@humanharness/harness-sdk";
import type { Configuration } from "electron-builder";
import { checkHarness, formatFindings } from "./check";
import { CliError, type Io, UsageError, parseCommand } from "./cli";
import { packageConfig } from "./package-config";
import { CORE_DIR, shellDir } from "./paths";
import { buildTools } from "./tool-build";

/** The two slow steps `package` runs (tests replace them). */
export interface PackageDeps {
  /** The shell's `electron-vite build` with the harness, into outDir (as `dev --build`); resolves to its exit code. */
  buildShell(o: { harnessDir: string; outDir: string }): Promise<number>;
  /** electron-builder's build(); resolves to the artifact paths. */
  build(o: { config: Configuration; publish: "always" | "never" }): Promise<string[]>;
}

export interface PackageOptions {
  harnessDir: string;
  outDir: string;
  publish?: boolean;
  feed?: string;
  /** Where the signing variables are read from. */
  env: NodeJS.ProcessEnv;
  out: Writable;
  deps?: PackageDeps;
}

const SIGNING_VARS = ["CSC_LINK", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"] as const;

/** `humanharness package` (release spec §3.1): check, build the shell with the harness, package it with electron-builder. */
export async function packageCommand(o: PackageOptions): Promise<number> {
  const root = path.resolve(o.harnessDir);
  const write = (line: string) => o.out.write(`${line}\n`);
  // Signing needs the certificate; notarization, which a published build needs too, the App Store Connect key.
  const signing = SIGNING_VARS.every((k) => Boolean(o.env[k]));
  if (o.publish && !signing) {
    write("publishing needs a signed build: set CSC_LINK, CSC_KEY_PASSWORD, APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER.");
    return 1;
  }
  const checked = await checkHarness(root, { note: write });
  if (checked.findings.length > 0) o.out.write(formatFindings(checked.findings));
  const harness = checked.harness;
  if (!harness || checked.findings.some((f) => f.severity === "error")) {
    write("Fix the errors above before packaging the app.");
    return 1;
  }
  if (!signing) write(`No ${o.env.CSC_LINK ? "APPLE_API_KEY, APPLE_API_KEY_ID or APPLE_API_ISSUER" : "CSC_LINK"}: building an unsigned app (Gatekeeper will warn on other Macs).`);
  // The app reads dist/tools.json at start: build it first, as `dev` does. Without tools nothing is written.
  if (hasTools(harness)) {
    try {
      await buildTools(root, { write: true, harness });
    } catch (err) {
      if (!(err instanceof CliError)) throw err;
      write(err.message);
      return 1;
    }
  }
  const deps = o.deps ?? defaultDeps(o.out);
  const buildDir = await fs.mkdtemp(path.join(os.tmpdir(), "hh-package-"));
  try {
    if ((await deps.buildShell({ harnessDir: root, outDir: buildDir })) !== 0) {
      write("The shell build failed.");
      return 1;
    }
    const version = JSON.parse(await fs.readFile(path.join(CORE_DIR, "package.json"), "utf8")).version as string;
    const config = packageConfig({
      harness: { id: harness.id, name: harness.name, ...(harness.logo ? { logo: harness.logo } : {}) },
      version,
      platform: "mac",
      ...(o.feed ? { feed: o.feed } : {}),
      signing,
      harnessDir: root,
      appDir: shellDir(),
      buildDir,
      outDir: path.resolve(o.outDir),
    });
    const artifacts = await deps.build({ config, publish: o.publish ? "always" : "never" });
    for (const file of artifacts) write(file);
    return 0;
  } finally {
    await fs.rm(buildDir, { recursive: true, force: true });
  }
}

function defaultDeps(out: Writable): PackageDeps {
  return {
    buildShell: ({ harnessDir, outDir }) => {
      const shell = shellDir();
      const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: harnessDir, HH_OUT_DIR: outDir };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(path.join(shell, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shell, env, stdio: "inherit" });
      return new Promise((resolve) => {
        child.on("exit", (code) => resolve(code ?? 1));
        child.on("error", (err) => {
          out.write(`Could not start electron-vite: ${err.message}\n`);
          resolve(1);
        });
      });
    },
    build: async ({ config, publish }) => {
      // Loaded only here: the rest of the CLI never pays for electron-builder.
      const builder = await import("electron-builder");
      // projectDir: the shell, where electron is installed (its version names the Electron to package).
      return builder.build({ mac: [], config, publish, projectDir: config.directories?.app ?? undefined });
    },
  };
}

export async function packageCommandLine(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseCommand(args, { harness: { type: "string" }, publish: { type: "boolean" }, feed: { type: "string" }, out: { type: "string" } });
  if (positionals.length > 0) throw new UsageError("Usage: humanharness package [--harness <dir>] [--publish] [--feed <url>] [--out <dir>]");
  const harnessDir = path.resolve(io.cwd, values.harness ?? ".");
  // Default: a fixed temp folder per harness, never inside the harness (whose folder goes into the app).
  const outDir = values.out ? path.resolve(io.cwd, values.out) : path.join(os.tmpdir(), "humanharness-package", path.basename(harnessDir));
  const rel = path.relative(harnessDir, outDir);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) throw new UsageError("--out must be outside the harness folder (the harness folder is packaged into the app).");
  return packageCommand({
    harnessDir,
    outDir,
    ...(values.publish ? { publish: true } : {}),
    ...(values.feed ? { feed: values.feed } : {}),
    env: process.env,
    out: io.stdout,
  });
}
