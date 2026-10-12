import type { Readable, Writable } from "node:stream";
import { type ParseArgsConfig, parseArgs } from "node:util";

/** Where a command reads and writes: the process in the bin, memory in tests. */
export interface Io {
  cwd: string;
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
}

/** A wrong command line: the message is printed and the exit code is 2. */
export class UsageError extends Error {}

/** A clear stop (a harness with errors, an engine that isn't ready): the message is printed and the exit code is 1. */
export class CliError extends Error {}

/** `parseArgs` with positionals, where an unknown option is a UsageError. */
export function parseCommand<O extends NonNullable<ParseArgsConfig["options"]>>(args: string[], options: O) {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
}
