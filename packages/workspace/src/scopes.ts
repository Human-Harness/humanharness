import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { LINKED_KEYS_MAX, LINKED_MANY_MAX } from "@humanharness/harness-sdk";
import { isScopeId, scopesFile } from "./layout";

/** A folder linked to a scope (hatches spec §3.2). `path` is absolute and real (links resolved at link time). */
export interface LinkedFolderEntry {
  key: string;
  path: string;
  mode: "read" | "write";
  /** True: the core history tracks it (no git, D1). False: its own git is its history. */
  tracked: boolean;
  /** The folder gained or lost git since it was linked; the person hasn't confirmed the change yet (Decision 13). */
  gitChanged?: true;
  /**
   * The app's signature of the link (an HMAC with a key in its data folder): the file sits in the folder the agent can
   * write, so a link without a valid tag is ignored by the app. The store keeps it; the shell makes and checks it.
   */
  tag?: string;
  /** A random id of this link, signed with it: the app keeps the live ones outside the folder (no replay). */
  nonce?: string;
}

/** One entry of `.harness/scopes.json` (spec §3.2). The id never changes; renaming changes only the title. */
export interface ScopeEntry {
  id: string;
  title: string;
  createdAt: string;
  archived: boolean;
  /** Linked folders (hatches spec §3.2). Absent when there are none, so the file is today's (D0). */
  linked?: LinkedFolderEntry[];
  /**
   * The engine config the person approved (hatches spec §5.3): its hash and when (ISO). Absent until the first
   * approval, so the file is today's (D0). New sessions get the config only while the folder still hashes to it.
   */
  engineApproval?: EngineApproval;
}

export interface EngineApproval {
  hash: string;
  at: string;
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

const LINK_KEY = /^[a-z][a-z0-9_-]{0,63}$/;
const LINK_PATH_MAX = 4096;
const LINK_TAG_MAX = 128;
const LINK_NONCE = /^[0-9a-f]{16,64}$/;
/** An engine config hash: sha256, lowercase hex. */
const ENGINE_HASH = /^[0-9a-f]{64}$/;
const APPROVED_AT_MAX = 64;
/** The most links one entry can hold (every key full): a longer list in a hand-edited file is cut there. */
const LINKS_MAX = LINKED_KEYS_MAX * LINKED_MANY_MAX;

function cleanLink(v: unknown): LinkedFolderEntry | null {
  if (!isObject(v) || typeof v.key !== "string" || !LINK_KEY.test(v.key)) return null;
  if (typeof v.path !== "string" || v.path.length > LINK_PATH_MAX || !path.isAbsolute(v.path)) return null;
  if (v.mode !== "read" && v.mode !== "write") return null;
  if (typeof v.tracked !== "boolean") return null;
  return {
    key: v.key,
    path: v.path,
    mode: v.mode,
    tracked: v.tracked,
    ...(v.gitChanged === true ? { gitChanged: true as const } : {}),
    // A tag that isn't a short string is dropped: the link stays, untagged (so the app ignores it).
    ...(typeof v.tag === "string" && v.tag.length > 0 && v.tag.length <= LINK_TAG_MAX ? { tag: v.tag } : {}),
    ...(typeof v.nonce === "string" && LINK_NONCE.test(v.nonce) ? { nonce: v.nonce } : {}),
  };
}

function cleanApproval(v: unknown): EngineApproval | null {
  if (!isObject(v) || typeof v.hash !== "string" || !ENGINE_HASH.test(v.hash)) return null;
  if (typeof v.at !== "string" || !v.at || v.at.length > APPROVED_AT_MAX) return null;
  return { hash: v.hash, at: v.at };
}

function cleanEntry(v: unknown): ScopeEntry | null {
  if (!isObject(v) || !isScopeId(v.id) || typeof v.title !== "string" || !v.title.trim()) return null;
  const links: LinkedFolderEntry[] = [];
  const paths = new Set<string>();
  for (const l of Array.isArray(v.linked) ? v.linked : []) {
    if (links.length >= LINKS_MAX) break;
    const c = cleanLink(l);
    if (c && !paths.has(c.path)) {
      paths.add(c.path);
      links.push(c);
    }
  }
  return {
    id: v.id,
    title: v.title,
    createdAt: typeof v.createdAt === "string" ? v.createdAt : "",
    archived: v.archived === true,
    ...(links.length > 0 ? { linked: links } : {}),
    ...withApproval(cleanApproval(v.engineApproval)),
  };
}

const withApproval = (a: EngineApproval | null) => (a ? { engineApproval: a } : {});

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

  /**
   * Adds a link to scope `id`. Refuses a path the scope already links, and a key that is full: one folder,
   * or `LINKED_MANY_MAX` when the manifest declares the key `many`. The caller checked every refusal (L2).
   * With `valid`, the scope's links it rejects (ones the app didn't sign) are dropped in the same write, first.
   * Throws synchronously on an invalid entry, as `cleanTitle` does for `create`.
   */
  link(id: string, entry: LinkedFolderEntry, opts: { many?: boolean; valid?: (l: LinkedFolderEntry) => boolean } = {}): Promise<ScopeEntry> {
    const clean = cleanLink(entry);
    if (!clean) throw new Error("Invalid linked folder");
    const max = opts.many === true ? LINKED_MANY_MAX : 1;
    const valid = opts.valid;
    return this.update(id, (s) => {
      const links = valid ? (s.linked ?? []).filter((l) => valid(l)) : (s.linked ?? []);
      if (links.some((l) => l.path === clean.path)) throw new Error(`${clean.path} is already linked to this scope`);
      if (links.filter((l) => l.key === clean.key).length >= max) throw new Error(`"${clean.key}" takes at most ${max} linked folder${max === 1 ? "" : "s"}`);
      return { ...s, linked: [...links, clean] };
    });
  }

  /** Removes the link; never touches the folder. The last link removes the key (D0 shape). */
  unlink(id: string, key: string, folder: string): Promise<ScopeEntry> {
    return this.update(id, (s) => {
      const rest = (s.linked ?? []).filter((l) => !(l.key === key && l.path === folder));
      const { linked: _old, ...plain } = s;
      return rest.length > 0 ? { ...plain, linked: rest } : plain;
    });
  }

  /**
   * Sets whether the core history tracks the folder; confirms a git change (drops `gitChanged`). `tracked` is signed,
   * so the old tag no longer holds: `sign` makes the new one inside the write, from the entry as it is then (`current`;
   * it may throw to refuse). Without it the link is left untagged. The nonce is kept.
   */
  setTracked(
    id: string,
    key: string,
    folder: string,
    tracked: boolean,
    sign?: (next: LinkedFolderEntry, current: LinkedFolderEntry) => string,
  ): Promise<ScopeEntry> {
    return this.updateLink(id, key, folder, (l) => {
      const plain: LinkedFolderEntry = { key: l.key, path: l.path, mode: l.mode, tracked, ...(l.nonce !== undefined ? { nonce: l.nonce } : {}) };
      const next = cleanLink(sign ? { ...plain, tag: sign(plain, l) } : plain);
      if (!next) throw new Error("Invalid linked folder");
      return next;
    });
  }

  /**
   * Approves the scope's engine config by its hash at `now` (the store's clock without it). The caller computed the
   * hash right then and compared it with the one the person saw (E10); the store only checks its shape.
   * Throws synchronously on a hash that isn't 64 lowercase hex characters.
   */
  approveEngine(id: string, hash: string, now?: Date): Promise<ScopeEntry> {
    if (typeof hash !== "string" || !ENGINE_HASH.test(hash)) throw new Error("An engine config hash is 64 hex characters");
    const at = (now ?? this.now()).toISOString();
    return this.update(id, (s) => ({ ...s, engineApproval: { hash, at } }));
  }

  /** Removes the approval: the entry is written as before any approval (D0 shape). */
  clearEngineApproval(id: string): Promise<ScopeEntry> {
    return this.update(id, (s) => {
      const { engineApproval: _old, ...plain } = s;
      return plain;
    });
  }

  /** Records that the folder gained or lost git since it was linked (Decision 13). */
  markGitChanged(id: string, key: string, folder: string): Promise<ScopeEntry> {
    return this.updateLink(id, key, folder, (l) => ({ ...l, gitChanged: true }));
  }

  private updateLink(id: string, key: string, folder: string, fn: (l: LinkedFolderEntry) => LinkedFolderEntry): Promise<ScopeEntry> {
    return this.update(id, (s) => {
      const links = s.linked ?? [];
      const i = links.findIndex((l) => l.key === key && l.path === folder);
      if (i < 0) throw new Error("Unknown linked folder");
      return { ...s, linked: links.map((l, j) => (j === i ? fn(l) : l)) };
    });
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
