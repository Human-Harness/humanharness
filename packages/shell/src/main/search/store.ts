import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { type ChatMeta, type FileMeta, INDEX_VERSION } from "@humanharness/search";

/** §4.1: written at most every 5 s while changes come in, and once more on quit. */
export const SAVE_EVERY_MS = 5_000;
const MAX_RECENT = 8;

/** Beside the history's folder, never in the person's folder; one per base, so one per profile (plan deviation 2). */
export function searchDir(userData: string, base: string): string {
  return path.join(userData, "search", createHash("sha256").update(base).digest("hex").slice(0, 16));
}

export interface Snapshot {
  /** `MiniSearch`'s JSON, as `LiveIndex.toJSON` gives it. */
  index: string;
  files: Record<string, FileMeta>;
  chats: Record<string, ChatMeta>;
  /** The ids of the documents built in memory (actions, tasks), so a later run can take them out. */
  memory: string[];
  truncated: boolean;
}

/** Per profile (plan deviation 3): the last results opened (ids only) and the "All scopes" toggle. */
export interface SearchPrefs {
  recent: string[];
  allScopes: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isFileMeta = (v: unknown) => isObject(v) && typeof v.size === "number" && typeof v.mtimeMs === "number" && typeof v.how === "string";
const isChatMeta = (v: unknown) => isObject(v) && typeof v.size === "number" && Array.isArray(v.ids) && v.ids.every((i) => typeof i === "string");

async function writeAtomic(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, text, { mode: 0o600 });
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

export class IndexStore {
  private pending: (() => Snapshot) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    readonly dir: string,
    private readonly o: { delayMs?: number } = {},
  ) {}

  /** The saved snapshot; null when missing, broken or of another version (§4.1: rebuilt then). */
  async load(): Promise<Snapshot | null> {
    try {
      const meta: unknown = JSON.parse(await fs.readFile(path.join(this.dir, "files.json"), "utf8"));
      if (!isObject(meta) || meta.version !== INDEX_VERSION || !isObject(meta.files) || !isObject(meta.chats) || !Array.isArray(meta.memory)) return null;
      if (!Object.values(meta.files).every(isFileMeta) || !Object.values(meta.chats).every(isChatMeta) || !meta.memory.every((m) => typeof m === "string")) return null;
      const index = await fs.readFile(path.join(this.dir, "index.json"), "utf8");
      return { index, files: meta.files as Record<string, FileMeta>, chats: meta.chats as Record<string, ChatMeta>, memory: meta.memory as string[], truncated: meta.truncated === true };
    } catch {
      return null;
    }
  }

  /** Saves what `get` gives in at most 5 s; later calls before then only replace `get`. */
  schedule(get: () => Snapshot): void {
    this.pending = get;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.writeNow();
    }, this.o.delayMs ?? SAVE_EVERY_MS);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.writeNow();
  }

  private writeNow(): Promise<void> {
    const get = this.pending;
    this.pending = null;
    if (!get) return this.writing;
    this.writing = this.writing
      .then(async () => {
        const s = get();
        // The index first: files.json behind it only makes the next reconcile read a few files again.
        await writeAtomic(path.join(this.dir, "index.json"), s.index);
        await writeAtomic(path.join(this.dir, "files.json"), JSON.stringify({ version: INDEX_VERSION, files: s.files, chats: s.chats, memory: s.memory, truncated: s.truncated }));
      })
      .catch((err: unknown) => console.error("Could not save the search index", err instanceof Error ? err.message : "unknown error"));
    return this.writing;
  }

  /** The folder moved or the index is dropped: nothing pending is written, and the folder goes. */
  async discard(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    await this.writing;
    await fs.rm(this.dir, { recursive: true, force: true });
  }

  async prefs(): Promise<SearchPrefs> {
    try {
      const v: unknown = JSON.parse(await fs.readFile(path.join(this.dir, "prefs.json"), "utf8"));
      if (isObject(v)) {
        const recent = Array.isArray(v.recent) ? v.recent.filter((r): r is string => typeof r === "string").slice(0, MAX_RECENT) : [];
        return { recent, allScopes: v.allScopes === true };
      }
    } catch {
      // No prefs yet.
    }
    return { recent: [], allScopes: false };
  }

  savePrefs(p: SearchPrefs): Promise<void> {
    return writeAtomic(path.join(this.dir, "prefs.json"), JSON.stringify({ recent: p.recent.slice(0, MAX_RECENT), allScopes: p.allScopes }));
  }
}
