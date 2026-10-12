import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import type { Io } from "../src/cli";

/** The repository: what `--core` points at in tests. */
export const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** A writable that keeps what was written. */
export function memoryStream(): { stream: Writable; text: () => string } {
  let text = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += String(chunk);
      callback();
    },
  });
  return { stream, text: () => text };
}

/** An Io over memory: `input` is what the person types (already ended). */
export function memoryIo(cwd: string, input = "") {
  const out = memoryStream();
  const err = memoryStream();
  const stdin = new PassThrough();
  stdin.end(input);
  const io: Io = { cwd, stdin, stdout: out.stream, stderr: err.stream };
  return { io, out: out.text, err: err.text };
}

/** A temporary folder outside the repository, removed by `cleanup`. */
export function tempRoot(prefix: string): { root: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

export const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, file), "utf8");

/** Replaces `from` with `to` in a file of a harness repo; fails when `from` isn't there. */
export function replaceIn(dir: string, file: string, from: string, to: string): void {
  const text = read(dir, file);
  if (!text.includes(from)) throw new Error(`${file} has no ${JSON.stringify(from)}`);
  fs.writeFileSync(path.join(dir, file), text.replace(from, to));
}
