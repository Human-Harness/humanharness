import { existsSync } from "node:fs";
import path from "node:path";
import { HOME_MARK, findHome } from "../app-home";
import { CliError, UsageError } from "../cli";
import { coreOf } from "../kit/harness-project";
import { MANIFEST } from "../paths";

/**
 * What the server works on: the app's home folder (app mode), or a harness project and the core checkout it is
 * built on (harness mode; the folder may be new and empty, for `harness_init`).
 */
export type Mode = { mode: "app"; home: string } | { mode: "harness"; dir: string; core: string };

const OUTSIDE = "Run this inside the app's home folder or a harness project, or pass --home <dir> (the app) or --harness <dir> (a harness project)";

const harness = (dir: string): Mode => ({ mode: "harness", dir, core: coreOf(dir) });

/**
 * `--home <dir>` is app mode and `--harness <dir>` harness mode; without either, the nearest folder from `cwd` up
 * that has `harness.config.ts` (harness mode) or `.layers.json` (app mode), whichever comes first.
 */
export function findMode(cwd: string, flags: { home?: string; harness?: string }): Mode {
  if (flags.home !== undefined && flags.harness !== undefined) throw new UsageError("Pass --home <dir> or --harness <dir>, not both");
  if (flags.harness !== undefined) return harness(path.resolve(cwd, flags.harness));
  if (flags.home !== undefined) return { mode: "app", home: findHome(cwd, flags.home) };
  let dir = path.resolve(cwd);
  for (;;) {
    if (existsSync(path.join(dir, MANIFEST))) return harness(dir);
    if (existsSync(path.join(dir, HOME_MARK))) return { mode: "app", home: dir };
    const up = path.dirname(dir);
    if (up === dir) throw new CliError(OUTSIDE);
    dir = up;
  }
}
