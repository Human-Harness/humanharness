import { randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { PLUGIN_ID, PLUGIN_LOCAL_ID } from "@humanharness/harness-sdk";

/** Electron safeStorage, injected so tests never touch the real Keychain. */
export interface SecretCrypto {
  available(): boolean;
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
}

export type SecretResult = { ok: true } | { ok: false; message: string };

export const SECRET_MIN = 8;
export const SECRET_MAX = 8192;
/** An encrypted value is a little larger than its text; anything far bigger is not one of ours. */
const FILE_MAX = 64 * 1024;
const CANT_ENCRYPT = "This computer can't encrypt keys for this app";
const CONTROL = /[\u0000-\u001f\u007f]/;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const NONBLOCK = constants.O_NONBLOCK ?? 0;
/** A temp file `writeAtomic` left behind (a crash between open and rename): `.<id>.bin.<uuid>.tmp`. */
const LEFTOVER = /^\.([a-z0-9_-]+)\.bin\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;

/** The folder of the harness's own keys (tools spec §9): no plugin id can start with `_`, so it never meets a plugin's folder. */
export const HARNESS_SECRETS_OWNER = "_harness";

/** Whose key: the harness's own (Settings › Connections) or one plugin's. */
export type SecretOwner = "harness" | { plugin: string };

/** The spec's logical name of a key (tools spec §9): `<id>` for the harness, `plugin.<plugin>.<id>` for a plugin. */
export const secretName = (owner: SecretOwner, id: string): string => (owner === "harness" ? id : `plugin.${owner.plugin}.${id}`);

/**
 * The keys of the plugins (plugins spec §7, D5) and of the harness itself (tools spec §9), per harness:
 * `<dir>/<plugin>/<secret>.bin` and `<dir>/_harness/<secret>.bin`, each encrypted with Electron safeStorage. `dir` is
 * the app's own folder (`~/.humanharness/<harness-id>/secrets`), never under the base the agent can write to. Values
 * leave this class only through `values` and `harnessValues`, which only a broker calls: never to a renderer, never to
 * a log (B6). The plugin methods never take `_harness` as a plugin, and the harness methods only ever name `_harness`,
 * so the two never mix. Nothing below `dir` is followed through a link; a link there reads as missing and is never
 * written through or removed through.
 */
export class SecretStore {
  constructor(
    private readonly dir: string,
    private readonly crypto: SecretCrypto,
  ) {}

  /** The ids of the keys stored for `plugin`, sorted. Never their values. */
  async stored(plugin: string): Promise<string[]> {
    if (!validPlugin(plugin)) return [];
    return this.storedIn(plugin);
  }

  async set(plugin: string, id: string, value: string): Promise<SecretResult> {
    if (!validIds(plugin, id)) return { ok: false, message: "This key can't be stored" };
    return this.setIn(plugin, id, value);
  }

  async delete(plugin: string, id: string): Promise<void> {
    if (!validIds(plugin, id)) return;
    await this.deleteIn(plugin, id);
  }

  /**
   * Every key of `plugin`, any temp file a crashed write left, and its folder (Remove). A link in its place is left
   * alone (logged), never followed.
   */
  async deleteAll(plugin: string): Promise<void> {
    if (!validPlugin(plugin)) return;
    const folder = await this.folderOf(plugin, false);
    if (folder === null) return;
    for (const id of await this.storedIn(plugin)) await removePlain(path.join(folder, `${id}.bin`), fileTag(plugin));
    const entries = await fs.readdir(folder).catch(() => [] as string[]);
    for (const name of entries) {
      const m = LEFTOVER.exec(name);
      if (m !== null && PLUGIN_LOCAL_ID.test(m[1])) await removePlain(path.join(folder, name), fileTag(plugin));
    }
    await fs.rmdir(folder).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "ENOENT") console.warn(`${tag(plugin)}: key folder not removed (${err.code ?? err.message})`);
    });
  }

  /**
   * The decrypted values of `ids` for `plugin` (the broker only). A missing key is absent; one that can't be read or
   * no longer decrypts is absent too (logged without the value), never garbage.
   */
  async values(plugin: string, ids: readonly string[]): Promise<Record<string, string>> {
    if (!validPlugin(plugin)) return {};
    return this.valuesIn(plugin, ids);
  }

  /** The ids of the harness's own keys (tools spec §9), sorted. Never their values. */
  storedHarness(): Promise<string[]> {
    return this.storedIn(HARNESS_SECRETS_OWNER);
  }

  setHarness(id: string, value: string): Promise<SecretResult> {
    if (!validHarnessId(id)) return Promise.resolve({ ok: false, message: "This key can't be stored" });
    return this.setIn(HARNESS_SECRETS_OWNER, id, value);
  }

  async deleteHarness(id: string): Promise<void> {
    if (!validHarnessId(id)) return;
    await this.deleteIn(HARNESS_SECRETS_OWNER, id);
  }

  /** The decrypted values of `ids` (slice 2's tool broker only). Missing or unreadable: absent. */
  harnessValues(ids: readonly string[]): Promise<Record<string, string>> {
    return this.valuesIn(HARNESS_SECRETS_OWNER, ids.filter(validHarnessId));
  }

  private async storedIn(owner: string): Promise<string[]> {
    const folder = await this.folderOf(owner, false);
    if (folder === null) return [];
    const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".bin") && PLUGIN_LOCAL_ID.test(e.name.slice(0, -4)))
      .map((e) => e.name.slice(0, -4))
      .sort();
  }

  /** `owner` and `id` are checked by the caller. */
  private async setIn(owner: string, id: string, value: string): Promise<SecretResult> {
    if (typeof value !== "string") return { ok: false, message: "This key can't be stored" };
    const v = value.trim();
    if (v.length < SECRET_MIN) return { ok: false, message: `A key is at least ${SECRET_MIN} characters` };
    if (v.length > SECRET_MAX) return { ok: false, message: `A key is at most ${SECRET_MAX} characters` };
    if (CONTROL.test(v)) return { ok: false, message: "A key is one line" };
    let data: Buffer;
    try {
      if (!this.crypto.available()) return { ok: false, message: CANT_ENCRYPT };
      data = this.crypto.encrypt(v);
    } catch {
      // Never the error's text: it might carry the value.
      console.warn(`${tag(owner)}: encrypting key ${id} failed`);
      return { ok: false, message: CANT_ENCRYPT };
    }
    try {
      const folder = await this.folderOf(owner, true);
      if (folder === null) throw new Error("no folder");
      await writeAtomic(folder, `${id}.bin`, data);
      return { ok: true };
    } catch (err) {
      console.warn(`${tag(owner)}: storing key ${id} failed (${(err as Error).message})`);
      return { ok: false, message: "This key can't be stored" };
    }
  }

  /** `owner` and `id` are checked by the caller. */
  private async deleteIn(owner: string, id: string): Promise<void> {
    const folder = await this.folderOf(owner, false);
    if (folder === null) return;
    await removePlain(path.join(folder, `${id}.bin`), fileTag(owner));
  }

  /** `owner` is checked by the caller; each id is checked here. */
  private async valuesIn(owner: string, ids: readonly string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const folder = await this.folderOf(owner, false);
    if (folder === null) return out;
    for (const id of ids) {
      if (!validLocalId(id) || Object.hasOwn(out, id)) continue;
      const data = await readPlain(path.join(folder, `${id}.bin`), fileTag(owner));
      if (data === null) continue;
      try {
        const v = this.crypto.decrypt(data);
        if (typeof v !== "string" || v.length < SECRET_MIN || v.length > SECRET_MAX || CONTROL.test(v)) throw new Error("not a key");
        out[id] = v;
      } catch {
        console.warn(`${tag(owner)}: key ${id} can't be decrypted; treating it as missing`);
      }
    }
    return out;
  }

  /**
   * `<dir>/<owner>` (a plugin id or `_harness`), each level a real folder (not a link) with mode 0700; with `create`,
   * made when missing. Null when missing (and not created), when the owner is bad, when a level is a link or not a
   * folder, or when it can't be looked at (EACCES and the like; logged): reads see no keys rather than reject. With
   * `create` those last cases throw.
   */
  private async folderOf(owner: string, create: boolean): Promise<string | null> {
    if (typeof owner !== "string" || !(owner === HARNESS_SECRETS_OWNER || PLUGIN_ID.test(owner))) return null;
    const folder = path.join(this.dir, owner);
    for (const at of [this.dir, folder]) {
      let st = await fs.lstat(at).catch((err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") return null;
        if (create) throw err;
        console.warn(`${tag(owner)}: ${at} can't be read (${err.code ?? err.message}); no keys`);
        return "unreadable" as const;
      });
      if (st === "unreadable") return null;
      if (st === null) {
        if (!create) return null;
        await fs.mkdir(at, { recursive: at === this.dir, mode: 0o700 }).catch((err: NodeJS.ErrnoException) => {
          if (err.code !== "EEXIST") throw err;
        });
        st = await fs.lstat(at);
      }
      if (st.isSymbolicLink() || !st.isDirectory()) {
        console.warn(`${tag(owner)}: ${at} is ${st.isSymbolicLink() ? "a link" : "not a folder"}; refusing`);
        if (create) throw new Error("key folder is not a plain folder");
        return null;
      }
      if (create && (st.mode & 0o777) !== 0o700) await fs.chmod(at, 0o700);
    }
    return folder;
  }
}

/** The log prefix of an owner: `[plugins] <plugin>` as before, `[secrets] harness` for the harness's own keys. */
function tag(owner: string): string {
  return owner === HARNESS_SECRETS_OWNER ? "[secrets] harness" : `[plugins] ${owner}`;
}

/** The log prefix before a file name: `[plugins]` as before, `[secrets] harness:` for the harness's own keys. */
function fileTag(owner: string): string {
  return owner === HARNESS_SECRETS_OWNER ? "[secrets] harness:" : "[plugins]";
}

function validPlugin(plugin: unknown): plugin is string {
  return typeof plugin === "string" && PLUGIN_ID.test(plugin);
}

function validLocalId(id: unknown): id is string {
  return typeof id === "string" && PLUGIN_LOCAL_ID.test(id);
}

function validHarnessId(id: unknown): id is string {
  return validLocalId(id);
}

function validIds(plugin: unknown, id: unknown): boolean {
  return validPlugin(plugin) && validLocalId(id);
}

/** The bytes of a plain file (not a link, not hard-linked, not a pipe, at most FILE_MAX), or null (logged unless missing). */
async function readPlain(file: string, who: string): Promise<Buffer | null> {
  let h: fs.FileHandle | undefined;
  try {
    h = await fs.open(file, constants.O_RDONLY | NOFOLLOW | NONBLOCK);
    const st = await h.stat();
    if (!st.isFile()) throw new Error("not a regular file");
    if (st.nlink > 1) throw new Error("hard-linked");
    const buf = Buffer.alloc(FILE_MAX + 1);
    let n = 0;
    while (n < buf.length) {
      const { bytesRead } = await h.read(buf, n, buf.length - n, n);
      if (bytesRead === 0) break;
      n += bytesRead;
    }
    if (n > FILE_MAX) throw new Error("too large");
    return buf.subarray(0, n);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`${who} ${path.basename(file)} can't be read (${(err as Error).message})`);
    return null;
  } finally {
    await h?.close();
  }
}

/** Writes `data` as `name` in `dir`: a fresh 0600 temp file (O_EXCL, O_NOFOLLOW), then a rename over a plain file or nothing. */
async function writeAtomic(dir: string, name: string, data: Buffer): Promise<void> {
  const file = path.join(dir, name);
  const tmp = path.join(dir, `.${name}.${randomUUID()}.tmp`);
  try {
    const h = await fs.open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o600);
    try {
      await h.chmod(0o600);
      await h.writeFile(data);
    } finally {
      await h.close();
    }
    const st = await fs.lstat(file).catch(() => null);
    if (st !== null && !st.isFile()) throw new Error(`${name} is ${st.isSymbolicLink() ? "a link" : "not a regular file"}`);
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/** Removes `file` when it is a plain file; a link or anything else there is left alone (logged). */
async function removePlain(file: string, who: string): Promise<void> {
  const st = await fs.lstat(file).catch(() => null);
  if (st === null) return;
  if (!st.isFile()) {
    console.warn(`${who} ${path.basename(file)} is not a plain file; not removed`);
    return;
  }
  await fs.rm(file, { force: true });
}
