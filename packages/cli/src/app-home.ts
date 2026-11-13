import { existsSync } from "node:fs";
import path from "node:path";
import { CliError } from "./cli";

/** The file every home folder has once the app has started in it (the layers' record, minimal-core spec §5.1). */
export const HOME_MARK = ".layers.json";

/**
 * The app's home folder a command works on: `--home <dir>`, else the nearest folder from `cwd` up that holds
 * `.layers.json`.
 */
export function findHome(cwd: string, flag: string | undefined): string {
  if (flag !== undefined) {
    const dir = path.resolve(cwd, flag);
    if (!existsSync(dir)) throw new CliError(`${dir} doesn't exist`);
    return dir;
  }
  let dir = path.resolve(cwd);
  for (;;) {
    if (existsSync(path.join(dir, HOME_MARK))) return dir;
    const up = path.dirname(dir);
    if (up === dir) throw new CliError("Run this inside the app's home folder, or pass --home <dir>");
    dir = up;
  }
}
