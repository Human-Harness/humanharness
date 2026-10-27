import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isScopeId, scopesFile } from "./layout";

/** One entry of `.harness/scopes.json` (spec §3.2). The id never changes; renaming changes only the title. */
export interface ScopeEntry {
  id: string;
  title: string;
  createdAt: string;
  archived: boolean;
}

export const SCOPE_TITLE_MAX = 120;

/** The title as stored: one line, trimmed, 1–120 characters. Throws otherwise. */
export function cleanTitle(title: unknown): string {
  const t = typeof title === "string" ? title.replace(/\s*\n\s*/g, " ").trim() : "";
  if (!t || t.length > SCOPE_TITLE_MAX) throw new Error(`A scope title is 1–${SCOPE_TITLE_MAX} characters`);
  return t;
}

/** A slug of `title` (`fracciones`), numbered when `taken` holds it (`fracciones-2`); "scope" when nothing is left. */
export function scopeSlug(title: string, taken: ReadonlySet<string>): string {
  const base =
    title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 56)
      .replace(/-+$/, "") || "scope";
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function cleanEntry(v: unknown): ScopeEntry | null {
  if (!isObject(v) || !isScopeId(v.id) || typeof v.title !== "string" || !v.title.trim()) return null;
  return { id: v.id, title: v.title, createdAt: typeof v.createdAt === "string" ? v.createdAt : "", archived: v.archived === true };
}

/** The scope registry of a base folder. Writes are atomic and one at a time. */
export class ScopeStore {
  private readonly file: string;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    base: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.file = scopesFile(base);
  }

  /** Whether the registry file is there (the migration's done marker). */
  exists(): Promise<boolean> {
    return fs.access(this.file).then(
      () => true,
      () => false,
    );
  }

  /** In creation order. A missing file is empty; one that isn't JSON is set aside as `scopes.json.corrupt-<time>`. */
  async list(): Promise<ScopeEntry[]> {
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
      await fs.rename(this.file, `${this.file}.corrupt-${Date.now()}`);
      return [];
    }
    const seen = new Set<string>();
    const out: ScopeEntry[] = [];
    for (const v of Array.isArray(raw) ? raw : []) {
      const e = cleanEntry(v);
      if (e && !seen.has(e.id)) {
        seen.add(e.id);
        out.push(e);
      }
    }
    return out;
  }

  create(title: unknown): Promise<ScopeEntry> {
    const clean = cleanTitle(title);
    return this.change((list) => {
      const entry: ScopeEntry = { id: scopeSlug(clean, new Set(list.map((s) => s.id))), title: clean, createdAt: this.now().toISOString(), archived: false };
      return [[...list, entry], entry];
    });
  }

  /** Adds `entry` under its own id, unless that id is registered already (the migration's `main`). */
  add(entry: ScopeEntry): Promise<ScopeEntry> {
    return this.change((list) => {
      const there = list.find((s) => s.id === entry.id);
      return there ? [list, there] : [[...list, entry], entry];
    });
  }

  rename(id: string, title: unknown): Promise<ScopeEntry> {
    const clean = cleanTitle(title);
    return this.update(id, (s) => ({ ...s, title: clean }));
  }

  setArchived(id: string, archived: boolean): Promise<ScopeEntry> {
    return this.update(id, (s) => ({ ...s, archived }));
  }

  private update(id: string, fn: (s: ScopeEntry) => ScopeEntry): Promise<ScopeEntry> {
    return this.change((list) => {
      const i = list.findIndex((s) => s.id === id);
      if (i < 0) throw new Error(`Unknown scope: "${id}"`);
      const next = fn(list[i]);
      return [list.map((s, j) => (j === i ? next : s)), next];
    });
  }

  private change<T>(fn: (list: ScopeEntry[]) => [ScopeEntry[], T]): Promise<T> {
    const run = this.writes.then(async () => {
      const [list, result] = fn(await this.list());
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(tmp, `${JSON.stringify(list, null, 2)}\n`);
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
