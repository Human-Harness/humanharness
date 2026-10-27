import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { profilesFile } from "./layout";

/** A profile id: a slug of its first name. It names the profile's folder inside the app's folder (spec D2). */
export const PROFILE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const isProfileId = (v: unknown): v is string => typeof v === "string" && PROFILE_ID.test(v);
export const PROFILE_TITLE_MAX = 40;
const SLUG_MAX = 32;
/** A colour the registry keeps: a plain word; the window decides whether it can draw it. */
const COLOR = /^[a-z]{1,20}$/;

/** One entry of `profiles.json` (spec §4). The id never changes; renaming changes only the title. */
export interface ProfileEntry {
  id: string;
  title: string;
  color?: string;
  createdAt: string;
  archived: boolean;
}

/** The title as stored: one line, trimmed, 1–40 characters. Throws otherwise. */
export function cleanProfileTitle(title: unknown): string {
  const t = typeof title === "string" ? title.replace(/\s*\n\s*/g, " ").trim() : "";
  if (!t || t.length > PROFILE_TITLE_MAX) throw new Error(`A profile's name is 1–${PROFILE_TITLE_MAX} characters`);
  return t;
}

/** A slug of `title` (`sofi`), numbered when `taken` holds it (`sofi-2`); "profile" when nothing is left. */
export function profileSlug(title: string, taken: ReadonlySet<string>): string {
  const base =
    title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, SLUG_MAX)
      .replace(/-+$/, "") || "profile";
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

/** The folder of profile `id` inside the app's folder. Throws for anything that isn't a profile id. */
export function profileDir(root: string, id: string): string {
  if (!isProfileId(id)) throw new Error(`Invalid profile: "${id}"`);
  return path.join(root, id);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const colorOf = (v: unknown): { color?: string } => (typeof v === "string" && COLOR.test(v) ? { color: v } : {});

function cleanEntry(v: unknown): ProfileEntry | null {
  if (!isObject(v) || !isProfileId(v.id) || typeof v.title !== "string" || !v.title.trim()) return null;
  return { id: v.id, title: v.title, ...colorOf(v.color), createdAt: typeof v.createdAt === "string" ? v.createdAt : "", archived: v.archived === true };
}

/** The profile registry of the app's folder. Writes are atomic and one at a time. */
export class ProfileStore {
  private readonly file: string;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly root: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.file = profilesFile(root);
  }

  /** In creation order. A missing file is empty; one that isn't JSON is set aside as `profiles.json.corrupt-<time>`. */
  async list(): Promise<ProfileEntry[]> {
    let text: string;
    try {
      text = await fs.readFile(this.file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      await fs.rename(this.file, `${this.file}.corrupt-${Date.now()}`).catch((err: NodeJS.ErrnoException) => {
        // Another read set it aside first.
        if (err.code !== "ENOENT") throw err;
      });
      return [];
    }
    const seen = new Set<string>();
    const out: ProfileEntry[] = [];
    for (const v of isObject(raw) && Array.isArray(raw.profiles) ? raw.profiles : []) {
      const e = cleanEntry(v);
      if (e && !seen.has(e.id)) {
        seen.add(e.id);
        out.push(e);
      }
    }
    return out;
  }

  /** A new profile. Its id is never one the registry or the root folder already has (any case). */
  create(title: unknown, color?: string): Promise<ProfileEntry> {
    const clean = cleanProfileTitle(title);
    return this.change(async (list) => {
      const onDisk = await fs.readdir(this.root).catch(() => [] as string[]);
      const taken = new Set([...list.map((p) => p.id), ...onDisk.map((n) => n.toLowerCase())]);
      const entry: ProfileEntry = { id: profileSlug(clean, taken), title: clean, ...colorOf(color), createdAt: this.now().toISOString(), archived: false };
      return [[...list, entry], entry];
    });
  }

  /** The registry's copy of the profile's record: its name and colour (spec §4). */
  setIdentity(id: string, identity: { title: unknown; color?: unknown }): Promise<ProfileEntry> {
    const title = cleanProfileTitle(identity.title);
    return this.update(id, (p) => {
      const { color: _old, ...rest } = p;
      return { ...rest, title, ...colorOf(identity.color) };
    });
  }

  setArchived(id: string, archived: boolean): Promise<ProfileEntry> {
    return this.update(id, (p) => ({ ...p, archived }));
  }

  /** Drops the entry; the caller has put the folder in the Trash first. */
  remove(id: string): Promise<void> {
    return this.change(async (list) => {
      if (!list.some((p) => p.id === id)) throw new Error(`Unknown profile: "${id}"`);
      return [list.filter((p) => p.id !== id), undefined];
    });
  }

  private update(id: string, fn: (p: ProfileEntry) => ProfileEntry): Promise<ProfileEntry> {
    return this.change(async (list) => {
      const i = list.findIndex((p) => p.id === id);
      if (i < 0) throw new Error(`Unknown profile: "${id}"`);
      const next = fn(list[i]);
      return [list.map((p, j) => (j === i ? next : p)), next];
    });
  }

  private change<T>(fn: (list: ProfileEntry[]) => Promise<[ProfileEntry[], T]>): Promise<T> {
    const run = this.writes.then(async () => {
      const [list, result] = await fn(await this.list());
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(tmp, `${JSON.stringify({ version: 1, profiles: list }, null, 2)}\n`);
        await fs.rename(tmp, this.file);
      } catch (err) {
        await fs.rm(tmp, { force: true });
        throw err;
      }
      return result;
    });
    this.writes = run.catch(() => undefined);
    return run;
  }
}
