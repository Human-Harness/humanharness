import { CliError } from "../cli";
import { findHome } from "../app-home";

/** What the server works on: for now only the app's home folder; harness projects come later. */
export type Mode = { mode: "app"; home: string };

/** `--home <dir>`, else the home folder found walking up from `cwd`; `--harness` is reserved. */
export function findMode(cwd: string, flags: { home?: string; harness?: string }): Mode {
  if (flags.harness !== undefined) throw new CliError("harness mode isn't available yet");
  try {
    return { mode: "app", home: findHome(cwd, flags.home) };
  } catch (err) {
    if (flags.home === undefined && err instanceof CliError) {
      throw new CliError("Run this inside the app's home folder, or pass --home <dir> (harness projects come later)");
    }
    throw err;
  }
}
