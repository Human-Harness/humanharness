import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Writable } from "node:stream";
import { type Io, UsageError, parseCommand } from "./cli";
import { type DevSpawn, devCommand } from "./dev";
import { buildPlugin } from "./plugin-build";
import { checkPlugin, formatPluginFindings } from "./plugin-check";

export const DEV_USAGE = [
  "Usage: humanharness plugin dev --harness <dir> [--plugin <dir>] [--live] [--mock]",
  "",
  "Builds and checks the plugin, then opens the harness with it as a dev plugin (on, without review), on its",
  "fixtures: no network, no keys. Every change to the plugin's sources rebuilds it and the app reloads it; a failed",
  "build keeps the last good dist/. --live uses the real network and the keys stored in Settings › Plugins.",
  "--mock opens the harness in mock mode as `humanharness dev --mock` does (the plugin stays on its fixtures).",
  "",
].join("\n");

/**
 * Watches a folder recursively; `onChange` gets the changed path relative to it (null when the OS doesn't say), and
 * `onError` is called once if the watcher stops on its own (the folder removed).
 */
export type PluginWatch = (dir: string, onChange: (file: string | null) => void, onError: (err: unknown) => void) => { close(): void };

/** Quiet time after the last change before a rebuild. */
const DEBOUNCE_MS = 300;

/**
 * Changes that never rebuild: the build's own output (dist/ and its swap folders, Task 15), the fixtures (the app
 * rereads them), dependencies, dot-folders and changes the OS reports without a name (they could be the build's own
 * writes, and would loop).
 */
export function ignoredChange(file: string | null): boolean {
  if (!file) return true;
  const parts = file.split(/[\\/]/).filter(Boolean);
  const [first] = parts;
  if (first === undefined) return true;
  if (first === "dist" || first.startsWith("dist.tmp-") || first.startsWith("dist.old-") || first === "fixtures") return true;
  return parts.some((p) => p === "node_modules" || p.startsWith("."));
}

export const fsWatch: PluginWatch = (dir, onChange, onError) => {
  const w = fs.watch(dir, { recursive: true }, (_event, file) => onChange(file === null ? null : String(file)));
  // A watcher error (the folder removed) must not kill the app the developer is looking at: it is said, not thrown.
  w.on("error", (err) => {
    w.close();
    onError(err);
  });
  return { close: () => w.close() };
};

export interface PluginDevOptions {
  pluginDir: string;
  harnessDir: string;
  /** The real network and the stored keys instead of the fixtures. */
  live?: boolean;
  /** The harness in mock mode (`dev --mock`). */
  mock?: boolean;
  out: Writable;
  spawn?: DevSpawn;
  watch?: PluginWatch;
  /** What a change runs (tests). Default: buildPlugin, which swaps dist/ only on success. */
  rebuild?: (dir: string) => Promise<unknown>;
}

/**
 * `humanharness plugin dev` (plugins spec §9.2): build and check the plugin, then `dev` with it in HH_PLUGIN_DIRS and,
 * unless --live, HH_PLUGIN_FIXTURES=1. The plugin folder is watched while the app runs; the app's own dev watcher
 * (Task 9) reloads the plugin when dist/ changes. The watcher and its timer go when the app exits.
 */
export async function pluginDevCommand(o: PluginDevOptions): Promise<number> {
  if (o.live && o.mock) throw new UsageError("--live and --mock don't go together: mock mode always plays the fixtures.");
  const dir = path.resolve(o.pluginDir);
  // HH_PLUGIN_DIRS is a path.delimiter-separated list.
  if (dir.includes(path.delimiter)) throw new UsageError(`The plugin folder's path can't contain "${path.delimiter}": ${dir}`);
  const { manifest, findings } = await checkPlugin(dir, { harness: o.harnessDir });
  if (findings.length > 0) o.out.write(formatPluginFindings(findings));
  if (!manifest || findings.some((f) => f.severity === "error")) {
    o.out.write("Fix the errors above before opening the app.\n");
    return 1;
  }
  if (o.live) {
    const hosts = manifest.permissions.hosts;
    o.out.write(
      hosts.length > 0
        ? `Live: this plugin will reach ${hosts.join(", ")} with your keys from Settings › Plugins.\n`
        : "Live: this plugin reaches no hosts; its declared commands run for real.\n",
    );
  }

  const rebuild = o.rebuild ?? ((d: string) => buildPlugin(d));
  let watcher: { close(): void } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let building: Promise<void> | null = null;
  let again = false;
  let closed = false;

  const run = async (): Promise<void> => {
    if (closed) return;
    if (building) {
      again = true;
      return;
    }
    building = (async () => {
      try {
        await rebuild(dir);
        o.out.write(`Rebuilt ${manifest.id}.\n`);
      } catch (err) {
        o.out.write(`The build failed; the app keeps the last good dist/: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    })();
    await building;
    building = null;
    if (again) {
      again = false;
      await run();
    }
  };
  const onChange = (file: string | null) => {
    if (closed || ignoredChange(file)) return;
    clearTimeout(timer);
    timer = setTimeout(() => void run(), DEBOUNCE_MS);
  };
  // The watcher starts with the app: a harness that fails its check opens nothing and watches nothing.
  const spawn: DevSpawn = (command, args, options) => {
    watcher = (o.watch ?? fsWatch)(dir, onChange, () => {
      if (!closed) o.out.write(`Stopped watching ${dir}; restart plugin dev.\n`);
    });
    return (o.spawn ?? (nodeSpawn as unknown as DevSpawn))(command, args, options);
  };

  try {
    return await devCommand({
      harnessDir: o.harnessDir,
      ...(o.mock ? { mock: true } : {}),
      env: { HH_PLUGIN_DIRS: dir, ...(o.live ? {} : { HH_PLUGIN_FIXTURES: "1" }) },
      out: o.out,
      spawn,
    });
  } finally {
    closed = true;
    clearTimeout(timer);
    (watcher as { close(): void } | null)?.close();
    // A build already running finishes before the command returns, so nothing writes after it.
    await (building as Promise<void> | null);
  }
}

export async function pluginDevCommandLine(args: string[], io: Io, run: typeof pluginDevCommand = pluginDevCommand): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    io.stdout.write(DEV_USAGE);
    return 0;
  }
  const { values, positionals } = parseCommand(args, { harness: { type: "string" }, plugin: { type: "string" }, live: { type: "boolean" }, mock: { type: "boolean" } });
  if (positionals.length > 0 || values.harness === undefined) throw new UsageError(DEV_USAGE.trim());
  return run({
    pluginDir: path.resolve(io.cwd, values.plugin ?? "."),
    harnessDir: path.resolve(io.cwd, values.harness),
    ...(values.live ? { live: true } : {}),
    ...(values.mock ? { mock: true } : {}),
    out: io.stdout,
  });
}
