import { Buffer } from "node:buffer";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { PluginManifest } from "@humanharness/harness-sdk";
import { type FixtureExchange, hideSecrets, stripSecrets } from "@humanharness/harness-sdk/plugin-fixtures";
import { isPublicHost, runFile } from "@humanharness/shell/plugins";
import { CliError } from "./cli";
import { buildPlugin } from "./plugin-build";
import { readBuiltManifest, runSource } from "./plugin-run";
import { P12_NOTE } from "./plugin-test";

/** Asks one question and reads one line; null when the input ended. */
export type AskLine = (question: string) => Promise<string | null>;
/** Asks for a key with the typed characters hidden. */
export type ReadSecret = (question: string) => Promise<string>;

export interface RecordDeps {
  /** The live network; tests pass a fake (never the real network). */
  fetch: typeof fetch;
  /** The live process runner; tests pass a fake. */
  run: typeof runFile;
  /** A command's absolute path on this computer. */
  resolve(cmd: string): Promise<string | null>;
  /** Public addresses only, as for the app's links; tests pass their own. */
  allowHost(hostname: string): Promise<boolean>;
  readSecret: ReadSecret;
  ask: AskLine;
  /** Whether the keys can be asked in a terminal. */
  isTTY: boolean;
}

export interface RecordOptions {
  source: string;
  /** Delete the source's old fixtures without asking. */
  yes?: boolean;
  /** Skip `build` (dist/ is used as it is). */
  build?: boolean;
}

/** The app's cap on fixture files per source (Decision 14). */
const MAX_EXCHANGES = 200;
/** The broker's cap on a response body (FETCH_LIMITS.maxBytes). */
const MAX_BODY = 10 * 1024 * 1024;
const YES = /^y(es)?$/i;
const SECRET_REF = /\{\{secret:([a-z][a-z0-9_-]{0,39})\}\}/g;
/** A base64 run long enough to hold a credential, e.g. Basic auth's `user:key`. */
const B64_RUN = /[A-Za-z0-9+/_-]{8,}={0,2}/g;

/** Keys' ids `backend.js` names as `{{secret:<id>}}`, among the declared ones, in declared order. */
async function referencedSecrets(dir: string, m: PluginManifest): Promise<PluginManifest["permissions"]["secrets"]> {
  const code = await fs.readFile(path.join(dir, "dist", "backend.js"), "utf8").catch(() => "");
  const named = new Set([...code.matchAll(SECRET_REF)].map((x) => x[1]));
  return m.permissions.secrets.filter((s) => named.has(s.id));
}

/** A plain-text line for the terminal: no control characters a plugin could use to redraw it. */
const plain = (s: string) => s.replace(/[\x00-\x1f\x7f-\x9f]/g, " ");

/** The body as text, read up to the broker's own cap (10 MB): past it the read stops and the request fails. */
async function cappedText(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY) {
      await reader.cancel().catch(() => undefined);
      throw new Error("The response is larger than 10 MB");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * A live transport that keeps every exchange, as the broker made it (keys already filled in) and as the service
 * answered: what `stripSecrets` then cleans. The broker's checks run before it is called.
 */
function recordingTransport(d: RecordDeps, exchanges: FixtureExchange[]) {
  return {
    fetch: (async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init.method ?? "GET").toUpperCase();
      const headers = Object.fromEntries(new Headers(init.headers));
      const body = typeof init.body === "string" ? init.body : undefined;
      const res = await d.fetch(url, init);
      const text = await cappedText(res);
      // A session cookie isn't one of the plugin's keys, but it is a credential: it never goes into a fixture.
      const outHeaders = Object.fromEntries([...res.headers].filter(([k, v]) => k !== "set-cookie" && k.length <= 200 && v.length <= 8192));
      exchanges.push({
        kind: "fetch",
        request: { method, url, ...(Object.keys(headers).length > 0 ? { headers } : {}), ...(body !== undefined ? { body } : {}) },
        response: { status: res.status, headers: outHeaders, text },
      });
      const nullBody = res.status === 204 || res.status === 205 || res.status === 304;
      return new Response(nullBody ? null : text, { status: res.status, headers: res.headers });
    }) as typeof fetch,
    run: (async (file, args, o) => {
      const out = await d.run(file, args, o);
      exchanges.push({ kind: "exec", request: { cmd: path.basename(file), args: [...args] }, response: { code: out.code, stdout: out.stdout, stderr: out.stderr } });
      return out;
    }) as typeof runFile,
  };
}

/**
 * Basic auth credentials, `<user>:<key>` base64-encoded as a whole: the key's own base64 can't be seen at that
 * offset, so the whole credential is stripped as if it were the key.
 */
function wrappedKeys(exchange: FixtureExchange, keys: Map<string, string>): [string, string][] {
  const found: [string, string][] = [];
  const text = JSON.stringify(exchange);
  for (const m of text.matchAll(B64_RUN)) {
    const decoded = Buffer.from(m[0], "base64").toString("utf8");
    if (decoded.length > 1024 || /[\x00-\x1f\x7f]/.test(decoded)) continue;
    // Only Basic auth's shape, `<user>:<key>`: any other key inside a base64 blob stays a leak (nothing is written).
    for (const [id, key] of keys) if (decoded.endsWith(`:${key}`) && !decoded.slice(0, -key.length - 1).includes(":")) found.push([id, decoded]);
  }
  return found;
}

/** P11: every key's forms replaced by `{{secret:<id>}}`; `leaked` when one still shows in any form we can decode. */
export function stripExchange(exchange: FixtureExchange, keys: Map<string, string>): { exchange: FixtureExchange; leaked: boolean } {
  let out = exchange;
  for (const [id, wrapped] of wrappedKeys(exchange, keys)) out = stripSecrets(out, { [id]: wrapped }).exchange;
  const r = stripSecrets(out, Object.fromEntries(keys));
  return { exchange: r.exchange, leaked: r.leaked.length > 0 };
}

/** `fixtures/<source>/*.json` now there; the folder must be a real folder, never a link. */
async function oldFixtures(folder: string): Promise<string[]> {
  const st = await fs.lstat(folder).catch(() => null);
  if (!st) return [];
  if (!st.isDirectory()) throw new CliError(`${folder} is not a folder.`);
  return (await fs.readdir(folder, { withFileTypes: true })).filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => e.name);
}

/**
 * `humanharness plugin record <source>` (spec §9.4, Decision 20): builds, runs one real sync of `source` with keys
 * asked in the terminal, and writes `fixtures/<source>/001.json`… with every key replaced by `{{secret:<id>}}` (P11).
 * Keys stay in this run's memory: never in a file, a log, an error or the terminal.
 */
export async function recordPlugin(dir: string, o: RecordOptions, d: RecordDeps, out: Writable): Promise<number> {
  if (o.build !== false) await buildPlugin(dir);
  const m = await readBuiltManifest(dir);
  if (!m.sources.some((s) => s.id === o.source)) {
    throw new CliError(`"${o.source}" is not a source of ${m.id} (${m.sources.map((s) => s.id).join(", ") || "none"}).`);
  }
  if (m.permissions.secrets.length > 0 && !d.isTTY) throw new CliError("record asks for keys in a terminal");
  // P12, before any key is typed: the plugin's code runs in this process and could read what is typed.
  out.write(`${P12_NOTE} While it runs, it can read the keys you type here.\n`);

  const keys = new Map<string, string>();
  const ask = async (s: PluginManifest["permissions"]["secrets"][number]) => {
    const value = await d.readSecret(`${s.label}${s.help ? ` (${s.help})` : ""}: `);
    if (value === "") throw new CliError(`No key was given for ${s.label}.`);
    keys.set(s.id, value);
  };
  for (const s of await referencedSecrets(dir, m)) await ask(s);
  // A key the backend names in a way the scan can't see is asked when the broker first needs it, one at a time.
  let asking: Promise<unknown> = Promise.resolve();
  const secrets = async (ids: string[]) => {
    for (const id of ids) {
      if (keys.has(id)) continue;
      const s = m.permissions.secrets.find((x) => x.id === id);
      if (s) await (asking = asking.then(() => (keys.has(id) ? undefined : ask(s))));
    }
    return Object.fromEntries(ids.filter((id) => keys.has(id)).map((id) => [id, keys.get(id) as string]));
  };
  const hide = (text: string) => hideSecrets(text, [...keys.values()]);

  const exchanges: FixtureExchange[] = [];
  const report = await runSource({ dir, source: o.source, transport: recordingTransport(d, exchanges), secrets, resolve: d.resolve, allowHost: d.allowHost });
  if (!report.ok) {
    out.write(hide(plain(`${o.source}: FAILED: ${report.error ?? "unknown error"}`)) + "\n");
    for (const line of report.log) out.write(hide(plain(`  ${line}`)) + "\n");
    out.write("Nothing was written.\n");
    return 1;
  }
  if (exchanges.length === 0) {
    out.write(`${o.source} made no requests: nothing to record.\n`);
    return 0;
  }
  if (exchanges.length > MAX_EXCHANGES) {
    out.write(`${o.source} made ${exchanges.length} requests; the app plays at most ${MAX_EXCHANGES}. Nothing was written.\n`);
    return 1;
  }

  const files: string[] = [];
  for (const e of exchanges) {
    let stripped: { exchange: FixtureExchange; leaked: boolean } | null = null;
    try {
      stripped = stripExchange(e, keys);
    } catch {
      // Stripping broke the exchange (it no longer parses): treated as a leak, nothing is written.
    }
    if (!stripped || stripped.leaked) {
      const what = e.kind === "fetch" ? `${e.request.method} ${e.request.url}` : `${e.request.cmd} ${e.request.args.join(" ")}`;
      out.write(hide(plain(`A key could not be removed from the recording of ${what}; nothing was written.`)) + "\n");
      return 1;
    }
    files.push(`${JSON.stringify(stripped.exchange, null, 2)}\n`);
  }

  const root = path.join(dir, "fixtures");
  const rootStat = await fs.lstat(root).catch(() => null);
  if (rootStat && !rootStat.isDirectory()) throw new CliError(`${root} is not a folder.`);
  const folder = path.join(root, o.source);
  const old = await oldFixtures(folder);
  if (old.length > 0 && !o.yes) {
    const answer = await d.ask(`Delete the ${old.length} old fixture${old.length === 1 ? "" : "s"} of ${o.source}? (y/N) `);
    if (answer === null || !YES.test(answer.trim())) {
      out.write("Kept the old fixtures; nothing was written.\n");
      return 1;
    }
  }
  for (const name of old) await fs.rm(path.join(folder, name), { force: true });
  await fs.mkdir(folder, { recursive: true });
  const written: string[] = [];
  for (const [i, text] of files.entries()) {
    const name = `${String(i + 1).padStart(3, "0")}.json`;
    const handle = await fs.open(path.join(folder, name), fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0), 0o644);
    try {
      await handle.writeFile(text, "utf8");
    } finally {
      await handle.close();
    }
    written.push(path.join("fixtures", o.source, name));
  }
  out.write(`Recorded ${o.source}: ${written.length} exchange${written.length === 1 ? "" : "s"}, every key replaced by {{secret:<id>}}.\n`);
  for (const f of written) out.write(`  ${f}\n`);
  out.write(
    "Read them before you commit them: a key the service sends back hex-encoded, double-encoded or compressed, split across fields, or with its case changed isn't seen.\n",
  );
  return 0;
}

/** A key typed with nothing echoed: raw mode, character by character. Ctrl-C or Ctrl-D on an empty line cancels. */
export function hiddenReader(input: Readable & { isTTY?: boolean; setRawMode?: (on: boolean) => unknown }, output: Writable): ReadSecret {
  return (question) =>
    new Promise((resolve, reject) => {
      output.write(question);
      const raw = typeof input.setRawMode === "function";
      if (raw) input.setRawMode?.(true);
      let value = "";
      const finish = (err?: Error) => {
        input.off("data", onData);
        input.off("end", onEnd);
        if (raw) input.setRawMode?.(false);
        input.pause();
        output.write("\n");
        if (err) reject(err);
        else resolve(value);
      };
      const onEnd = () => finish(new CliError("The input ended before a key was typed."));
      const onData = (chunk: Buffer | string) => {
        for (const ch of String(chunk)) {
          if (ch === "\r" || ch === "\n") return finish();
          if (ch === "\u0003" || (ch === "\u0004" && value === "")) return finish(new CliError("Cancelled."));
          if (ch === "\u007f" || ch === "\b") value = [...value].slice(0, -1).join("");
          else if (ch >= " ") value += ch;
        }
      };
      input.on("data", onData);
      input.on("end", onEnd);
      input.resume();
    });
}

/** One line from `input` after `question`; null when the input ended. */
export function lineAsker(input: Readable, output: Writable): AskLine {
  return (question) =>
    new Promise((resolve) => {
      const rl = createInterface({ input, output, terminal: false });
      let answered = false;
      rl.once("line", (line) => {
        answered = true;
        rl.close();
        resolve(line);
      });
      rl.once("close", () => {
        if (!answered) resolve(null);
      });
      output.write(question);
    });
}

/** A command on this terminal's PATH, as the person would run it; a name with a slash is never looked up. */
export async function resolveOnPath(cmd: string): Promise<string | null> {
  if (cmd === "" || cmd.includes("/") || cmd.includes("\\")) return null;
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const file = path.join(dir, cmd);
    const ok = await fs
      .access(file, fsConstants.X_OK)
      .then(() => fs.stat(file))
      .then((st) => st.isFile())
      .catch(() => false);
    if (ok) return file;
  }
  return null;
}

/** The live deps, over this process's terminal. */
export function liveRecordDeps(stdin: Readable, stdout: Writable): RecordDeps {
  return {
    fetch: globalThis.fetch,
    run: runFile,
    resolve: resolveOnPath,
    allowHost: isPublicHost,
    readSecret: hiddenReader(stdin, stdout),
    ask: lineAsker(stdin, stdout),
    isTTY: (stdin as { isTTY?: boolean }).isTTY === true,
  };
}
