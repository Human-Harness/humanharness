import { randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import type { HarnessSecret, HarnessSetupStep } from "@humanharness/harness-sdk";
import { hideSecrets } from "@humanharness/harness-sdk/plugin-fixtures";
import type { ConnectionLastTest, ConnectionResult, ConnectionView, ConnectionsView } from "@humanharness/ui/client";
import type { SecretStore } from "./secret-store";

/** What a tool's call says when a key it needs isn't stored (tools spec §9, §10). Used by slice 2's tool broker. */
export const missingSecretMessage = (label: string): string => `${label} is not set — Settings › Connections`;

/** A connect step's test (tools spec §9): the tool it runs and the secrets it lists. */
export interface ConnectTest {
  secrets: readonly string[];
  tool: string;
}

/** Each connect step that names a `test`, in manifest order. None: no Test anywhere (D0). */
export const connectTests = (setup: readonly HarnessSetupStep[] | undefined): ConnectTest[] =>
  (setup ?? []).flatMap((s) => (s.kind === "connect" && s.test !== undefined ? [{ secrets: s.secrets, tool: s.test }] : []));

/** "Test connection" (slice 2): only with a connect step that names a test. */
export interface ConnectionTestDeps {
  steps: readonly ConnectTest[];
  /** `connections.json` in the app's own per-harness folder (next to `secrets/`), never under the base. */
  file: string;
  /** Runs `tool` once with {} as the UI, in no scope (the tool registry: its own texts or the tool's hidden error). */
  run(tool: string): Promise<{ ok: true; result: unknown } | { ok: false; error: string }>;
  now?(): Date;
}

export interface ConnectionsDeps {
  /** The manifest's `secrets`. */
  secrets: readonly HarnessSecret[];
  /** `harnessValues` hides the stored keys in a test's message (absent: the registry's hiding alone). */
  store: Pick<SecretStore, "storedHarness" | "setHarness" | "deleteHarness"> & Partial<Pick<SecretStore, "harnessValues">>;
  /** Tells the window (hh:connectionsChange). */
  changed(view: ConnectionsView): void;
  log?(message: string, err?: unknown): void;
  /** Absent, or no step: no Test, and connections.json is never read or written (D0). */
  test?: ConnectionTestDeps;
}

/** The most a kept test message holds, in code points, once the stored keys are hidden. */
export const TEST_MESSAGE_MAX = 300;
/** connections.json is small (at most 10 keys); anything larger is not ours. */
const FILE_MAX = 64 * 1024;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const NONBLOCK = constants.O_NONBLOCK ?? 0;
/** What a test that couldn't run keeps: never its error (a disk path, a stack). */
const COULD_NOT_RUN = "The test couldn't run";

/**
 * Settings › Connections and the connect step in main (tools spec §9). Values go in through `set` and never come
 * out: the view says only whether each declared key is stored (S1). Only declared ids are touched (S3).
 */
export class ConnectionsController {
  /** connections.json writes, one at a time (a test and a set may overlap). */
  private writing: Promise<unknown> = Promise.resolve();

  constructor(private readonly d: ConnectionsDeps) {}

  /** A connect step names a test: Settings › Connections and the step show Test (hh:connectionsTest is registered). */
  get testable(): boolean {
    return (this.d.test?.steps.length ?? 0) > 0;
  }

  async view(): Promise<ConnectionsView> {
    const stored = new Set(await this.d.store.storedHarness().catch(() => [] as string[]));
    const tests = this.testable ? await this.readTests() : new Map<string, ConnectionLastTest>();
    return {
      connections: this.d.secrets.map((s): ConnectionView => {
        const testable = this.toolOf(s.id) !== undefined;
        const last = testable ? tests.get(s.id) : undefined;
        return { id: s.id, label: s.label, ...(s.help ? { help: s.help } : {}), set: stored.has(s.id), ...(testable ? { test: true as const } : {}), ...(last ? { lastTest: last } : {}) };
      }),
    };
  }

  /**
   * "Test connection": runs the tool of the connect step that lists `id`, once, with {} as the UI. Keeps the outcome
   * in connections.json — when, whether it worked, and the error with every stored key hidden — never a value.
   */
  async test(id: string): Promise<ConnectionResult> {
    if (!this.declared(id)) return { ok: false, message: "This harness declares no such key" };
    const tool = this.toolOf(id);
    if (tool === undefined) return { ok: false, message: "This key has no test" };
    let last: ConnectionLastTest;
    try {
      const answer = await this.d.test!.run(tool);
      last = { at: this.now(), ok: answer.ok, ...(answer.ok ? {} : { message: await this.shown(answer.error) }) };
    } catch (err) {
      this.log("A connection test failed", err);
      last = { at: this.now(), ok: false, message: COULD_NOT_RUN };
    }
    await this.keep(id, last);
    await this.push();
    return last.ok ? { ok: true } : { ok: false, message: last.message ?? COULD_NOT_RUN };
  }

  async set(id: string, value: string): Promise<ConnectionResult> {
    if (!this.declared(id)) return { ok: false, message: "This harness declares no such key" };
    // The store never logs a value; nor does this line (the error is the store's, the value stays here).
    const out = await this.d.store.setHarness(id, value).catch((err: unknown) => {
      this.log("Could not store a key", err);
      return { ok: false as const, message: "This key can't be stored" };
    });
    if (out.ok) {
      // A new key: the last test was of the old one.
      await this.keep(id, null);
      await this.push();
    }
    return out;
  }

  async delete(id: string): Promise<ConnectionResult> {
    if (!this.declared(id)) return { ok: false, message: "This harness declares no such key" };
    await this.d.store.deleteHarness(id);
    await this.keep(id, null);
    await this.push();
    return { ok: true };
  }

  /** Every id in `ids` is stored (a connect step's Next). An empty list is never all set (fail closed). */
  async allSet(ids: readonly string[]): Promise<boolean> {
    if (ids.length === 0) return false;
    const stored = new Set(await this.d.store.storedHarness().catch(() => [] as string[]));
    return ids.every((id) => stored.has(id));
  }

  /** The tool of the first connect step listing `id` with a test. */
  private toolOf(id: string): string | undefined {
    return this.d.test?.steps.find((s) => s.secrets.includes(id))?.tool;
  }
  private now(): string {
    return (this.d.test?.now?.() ?? new Date()).toISOString();
  }
  /** The error as kept and shown: every stored key hidden first, then cut (a cut never keeps a key's start). */
  private async shown(error: string): Promise<string> {
    const values = await this.d.store.harnessValues?.(this.d.secrets.map((s) => s.id)).catch((): Record<string, string> => ({}));
    const keys = Object.values(values ?? {});
    const hidden = keys.length > 0 ? hideSecrets(error, keys) : error;
    return [...hidden].slice(0, TEST_MESSAGE_MAX).join("") || COULD_NOT_RUN;
  }

  /** The kept tests of declared, testable ids. A missing, linked, too large or malformed file reads as none. */
  private async readTests(): Promise<Map<string, ConnectionLastTest>> {
    const out = new Map<string, ConnectionLastTest>();
    const text = await readSmall(this.d.test!.file).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "ENOENT") this.log("Could not read connections.json", err.code ?? err.message);
      return null;
    });
    if (text === null) return out;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return out;
    }
    const tests = isObject(parsed) && Object.hasOwn(parsed, "tests") ? parsed.tests : undefined;
    if (!isObject(tests)) return out;
    for (const s of this.d.secrets) {
      if (!Object.hasOwn(tests, s.id) || this.toolOf(s.id) === undefined) continue;
      const t = lastTest(tests[s.id]);
      if (t) out.set(s.id, t);
    }
    return out;
  }
  /** Keeps (or with null forgets) `id`'s last test. Only when a step names a test; a failure is logged, never thrown. */
  private keep(id: string, last: ConnectionLastTest | null): Promise<void> {
    if (!this.testable) return Promise.resolve();
    const next = this.writing.then(async () => {
      const tests = await this.readTests();
      if (last === null && !tests.has(id)) return;
      if (last === null) tests.delete(id);
      else tests.set(id, last);
      const body = `${JSON.stringify({ tests: Object.fromEntries(tests) }, null, 2)}\n`;
      if (Buffer.byteLength(body) > FILE_MAX) throw new Error("too large");
      await writeAtomic(this.d.test!.file, body);
    });
    this.writing = next.catch(() => {});
    return next.catch((err: unknown) => this.log("Could not keep a connection test", err));
  }

  /** A declared id, found with `some` (never an index into an object, so no prototype name is ever one). */
  private declared(id: unknown): id is string {
    return typeof id === "string" && this.d.secrets.some((s) => s.id === id);
  }
  private async push(): Promise<void> {
    try {
      this.d.changed(await this.view());
    } catch (err) {
      this.log("Could not send the connections to the window", err);
    }
  }
  private log(message: string, err?: unknown): void {
    (this.d.log ?? console.error)(message, err);
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** One kept test, as written: `at` an ISO time, `ok`, and a short `message` only on a failure. */
function lastTest(v: unknown): ConnectionLastTest | null {
  if (!isObject(v) || typeof v.at !== "string" || v.at.length > 40 || Number.isNaN(Date.parse(v.at)) || typeof v.ok !== "boolean") return null;
  if (v.ok) return { at: v.at, ok: true };
  const message = typeof v.message === "string" && v.message !== "" ? [...v.message].slice(0, TEST_MESSAGE_MAX).join("") : COULD_NOT_RUN;
  return { at: v.at, ok: false, message };
}

/** A plain file's text, never through a link or a hard link, at most FILE_MAX bytes. */
async function readSmall(file: string): Promise<string> {
  const h = await fs.open(file, constants.O_RDONLY | NOFOLLOW | NONBLOCK);
  try {
    const st = await h.stat();
    if (!st.isFile() || st.nlink > 1 || st.size > FILE_MAX) throw new Error("not a plain small file");
    const buf = Buffer.alloc(FILE_MAX + 1);
    let n = 0;
    while (n < buf.length) {
      const { bytesRead } = await h.read(buf, n, buf.length - n, n);
      if (bytesRead === 0) break;
      n += bytesRead;
    }
    if (n > FILE_MAX) throw new Error("too large");
    return buf.subarray(0, n).toString("utf8");
  } finally {
    await h.close();
  }
}

/** A fresh 0600 temp file (O_EXCL, O_NOFOLLOW) renamed over a plain file or nothing; a link there is never replaced. */
async function writeAtomic(file: string, text: string): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    const h = await fs.open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o600);
    try {
      await h.chmod(0o600);
      await h.writeFile(text);
    } finally {
      await h.close();
    }
    const st = await fs.lstat(file).catch(() => null);
    if (st !== null && !st.isFile()) throw new Error(`${path.basename(file)} is ${st.isSymbolicLink() ? "a link" : "not a regular file"}`);
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}
