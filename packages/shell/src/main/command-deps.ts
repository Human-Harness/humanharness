import { execFile } from "node:child_process";
import { constants, promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import type { CommandDeps } from "./engine-command";

const requireFromHere = createRequire(import.meta.url);

/**
 * How the app (and `humanharness run`) runs engine CLIs. `nodePath` runs the bundled adapters: Electron as
 * Node in the app, Node itself in the CLI. Modules resolve from the shell, where the adapters are dependencies.
 */
export function createCommandDeps(nodePath: string): CommandDeps {
  return {
    shell: process.env.SHELL || "/bin/zsh",
    home: os.homedir(),
    run: (cmd, args, env) =>
      new Promise((resolve) => {
        execFile(cmd, args, { timeout: 10_000, env: { ...process.env, ...env } }, (err, stdout) => {
          const e = err as (Error & { code?: unknown; killed?: boolean }) | null;
          const code = e ? (typeof e.code === "number" ? e.code : 1) : 0;
          resolve({
            stdout: String(stdout),
            code,
            // Killed by the timeout, or never started (e.g. ENOENT): no real answer.
            ...(e?.killed ? { timedOut: true } : {}),
            ...(e && typeof e.code === "string" ? { spawnError: true } : {}),
          });
        });
      }),
    isExecutable: (file) => fs.access(file, constants.X_OK).then(() => true, () => false),
    electronPath: nodePath,
    resolveModule: (id, from) => (from ? createRequire(from) : requireFromHere).resolve(id),
  };
}
