import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { GroundingMode } from "@humanharness/harness-sdk";
import { materialDir, materialStoreDir } from "@humanharness/workspace";
import { isFragmentId, parseFragment, renderFragment } from "./fragment";
import type { Fragment, FragmentMeta, SourceEntry } from "./types";

/** One row of the index (§4.3). */
export interface IndexRow {
  id: string;
  where: string;
  path: string;
  kind: string;
  summary: string;
  items: string[];
}

/** Sources whose fragments a task may load (§9): ready, or still being checked (their fragments are usable meanwhile). */
const USABLE = new Set(["ready", "validating"]);
export const isUsable = (s: Pick<SourceEntry, "status">): boolean => USABLE.has(s.status);

async function writeAtomic(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, text);
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();

/** A slug of a file name or a link (`fractions-ch-2`), numbered when `taken` holds it; "source" when nothing is left. */
export function sourceSlug(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .replace(/\.[A-Za-z0-9]{1,5}$/, "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/, "") || "source";
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

/**
 * One scope's material in one base (spec §4): the originals under `material/<scope>/`, the rest under
 * `.harness/material/<scope>/`. Registry writes are atomic and one at a time. Nothing is cached: a hand edit shows at once.
 */
export class MaterialStore {
  readonly dir: string;
  readonly originals: string;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    readonly base: string,
    readonly scope: string,
  ) {
    this.dir = materialStoreDir(base, scope);
    this.originals = materialDir(base, scope);
  }

  private get registry() {
    return path.join(this.dir, "sources.json");
  }
  private fragmentFile(id: string) {
    return path.join(this.dir, "fragments", `${id}.md`);
  }
  private origFile(id: string) {
    return path.join(this.dir, "fragments", ".orig", `${id}.md`);
  }

  /** In the order they were added. A missing file is empty; one that isn't JSON is set aside as `sources.json.corrupt-<time>`. */
  async sources(): Promise<SourceEntry[]> {
    let text: string;
    try {
      text = await fs.readFile(this.registry, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      await fs.rename(this.registry, `${this.registry}.corrupt-${Date.now()}`).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") throw err;
      });
      return [];
    }
    const list = typeof raw === "object" && raw !== null && Array.isArray((raw as { sources?: unknown }).sources) ? (raw as { sources: unknown[] }).sources : [];
    // Entries the app wrote; one a hand edit broke (no id, no status) is skipped.
    return list.filter((s): s is SourceEntry => typeof s === "object" && s !== null && typeof (s as SourceEntry).id === "string" && typeof (s as SourceEntry).status === "string");
  }

  async source(id: string): Promise<SourceEntry | null> {
    return (await this.sources()).find((s) => s.id === id) ?? null;
  }

  /** Changes the registry, one change at a time; `fn` gets a copy. Returns the new list. */
  update(fn: (list: SourceEntry[]) => SourceEntry[]): Promise<SourceEntry[]> {
    return this.queued(() => this.rewrite(fn));
  }

  /**
   * Runs `job` inside the registry queue, so fragment files and the registry change together; `job` changes the
   * registry only through the `rewrite` it gets (calling `update` from inside would wait on itself).
   */
  transact<T>(job: (rewrite: (fn: (list: SourceEntry[]) => SourceEntry[]) => Promise<SourceEntry[]>) => Promise<T>): Promise<T> {
    return this.queued(() => job((fn) => this.rewrite(fn)));
  }

  /** Runs `job` after every earlier registry change, one at a time. */
  private queued<T>(job: () => Promise<T>): Promise<T> {
    const run = this.writes.then(job);
    this.writes = run.catch(() => undefined);
    return run;
  }

  /** The registry change itself; callers hold the queue. */
  private async rewrite(fn: (list: SourceEntry[]) => SourceEntry[]): Promise<SourceEntry[]> {
    const next = fn(structuredClone(await this.sources()));
    await writeAtomic(this.registry, `${JSON.stringify({ version: 1, sources: next }, null, 2)}\n`);
    return next;
  }

  /** Changes one entry (no-op when it is gone). */
  patch(id: string, fn: (s: SourceEntry) => SourceEntry): Promise<SourceEntry | null> {
    return this.update((list) => list.map((s) => (s.id === id ? fn(s) : s))).then((list) => list.find((s) => s.id === id) ?? null);
  }

  /** Writes a source's fragments and records their ids; files of fragments it no longer has go. */
  async writeFragments(sourceId: string, fragments: Fragment[]): Promise<void> {
    // Every id names a file: all are checked before anything is written.
    if (!fragments.every((f) => isFragmentId(f.meta.id))) throw new Error("Invalid fragment id");
    // Inside the registry queue, so two writes for one source can't delete each other's files.
    await this.queued(async () => {
      const prev = (await this.sources()).find((s) => s.id === sourceId)?.fragments;
      const before = Array.isArray(prev) ? prev : [];
      for (const f of fragments) await writeAtomic(this.fragmentFile(f.meta.id), renderFragment(f));
      const now = new Set(fragments.map((f) => f.meta.id));
      for (const id of before) if (!now.has(id) && isFragmentId(id)) await fs.rm(this.fragmentFile(id), { force: true });
      await this.rewrite((list) => list.map((s) => (s.id === sourceId ? { ...s, fragments: fragments.map((f) => f.meta.id) } : s)));
    });
  }

  /** One fragment; null for an id that isn't one, a missing file or a broken one. */
  async readFragment(id: string): Promise<Fragment | null> {
    if (!isFragmentId(id)) return null;
    const text = await fs.readFile(this.fragmentFile(id), "utf8").catch(() => null);
    return text === null ? null : parseFragment(text);
  }

  /** Writes one fragment in place (labels, a repair, a flag). */
  async writeFragment(f: Fragment): Promise<void> {
    if (!isFragmentId(f.meta.id)) throw new Error("Invalid fragment id");
    await writeAtomic(this.fragmentFile(f.meta.id), renderFragment(f));
  }

  /** Changes one fragment's front matter; null when it is gone. */
  async patchFragment(id: string, fn: (meta: FragmentMeta) => FragmentMeta): Promise<Fragment | null> {
    const f = await this.readFragment(id);
    if (!f) return null;
    const next = { ...f, meta: fn(f.meta) };
    await this.writeFragment(next);
    return next;
  }

  /** Keeps the program's version of a fragment before the AI changes it (§6.2), once. */
  async keepOriginal(id: string): Promise<void> {
    if (!isFragmentId(id)) return;
    const file = this.origFile(id);
    if (await fs.stat(file).then(() => true, () => false)) return;
    const text = await fs.readFile(this.fragmentFile(id), "utf8").catch(() => null);
    if (text !== null) await writeAtomic(file, text);
  }

  async readOriginalVersion(id: string): Promise<Fragment | null> {
    if (!isFragmentId(id)) return null;
    const text = await fs.readFile(this.origFile(id), "utf8").catch(() => null);
    return text === null ? null : parseFragment(text);
  }

  /** Every fragment of the sources a task may load, in source order (pending ones included; callers filter). */
  async fragments(): Promise<Fragment[]> {
    const out: Fragment[] = [];
    for (const s of await this.sources()) {
      // A hand edit may have broken the list: then the source loads nothing.
      if (!isUsable(s) || !Array.isArray(s.fragments)) continue;
      for (const id of s.fragments) {
        const f = await this.readFragment(id);
        if (f) out.push(f);
      }
    }
    return out;
  }

  /** The index rows (§4.3): usable sources' fragments, leaving out those flagged during use (§6.2 "Flags during use"). */
  async indexRows(): Promise<IndexRow[]> {
    return (await this.fragments())
      .filter((f) => f.meta.validated !== "pending")
      .map((f) => ({ id: f.meta.id, where: `${f.meta.source}, ${f.meta.location}`, path: f.meta.path, kind: f.meta.kind ?? "", summary: f.meta.summary, items: f.meta.items }));
  }

  /** Rebuilds `index.md` (§4.3). */
  async writeIndex(): Promise<void> {
    const rows = await this.indexRows();
    const text = [
      "| id | where | path | kind | summary | items |",
      "|---|---|---|---|---|---|",
      ...rows.map((r) => `| ${r.id} | ${cell(r.where)} | ${cell(r.path)} | ${cell(r.kind)} | ${cell(r.summary)} | ${cell(r.items.join(", "))} |`),
    ].join("\n");
    await writeAtomic(path.join(this.dir, "index.md"), `${text}\n`);
  }

  /** Copies an original into `material/<scope>/`, never over another: `Ch 2.pdf`, `Ch 2 (2).pdf`… Returns its file name. */
  async addOriginal(name: string, data: Buffer): Promise<string> {
    await fs.mkdir(this.originals, { recursive: true });
    const trimmed = path.basename(name).replace(/[\0/\\]/g, "_").trim();
    const clean = trimmed === "" || trimmed === "." || trimmed === ".." ? "file" : trimmed;
    const ext = path.extname(clean);
    const stem = clean.slice(0, clean.length - ext.length);
    for (let i = 1; ; i++) {
      const candidate = i === 1 ? clean : `${stem} (${i})${ext}`;
      try {
        await fs.writeFile(path.join(this.originals, candidate), data, { flag: "wx" });
        return candidate;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
    }
  }

  /** An original's absolute path; null when the name would leave the scope's folder. */
  originalPath(name: string): string | null {
    const file = path.resolve(this.originals, name);
    return path.dirname(file) === path.resolve(this.originals) ? file : null;
  }

  /**
   * The scope's next scope stage (§10): "sheet" after a source finished or went away, "link" once the sheet is done
   * and the harness has items; null when both are current. Not tracked by the history.
   */
  async stale(): Promise<"sheet" | "link" | null> {
    const text = await fs.readFile(path.join(this.dir, ".stale"), "utf8").catch(() => null);
    return text === null ? null : text.trim() === "link" ? "link" : "sheet";
  }

  async setStale(next: "sheet" | "link" | false): Promise<void> {
    const file = path.join(this.dir, ".stale");
    if (next) await writeAtomic(file, next);
    else await fs.rm(file, { force: true });
  }

  async sheet(): Promise<string> {
    return fs.readFile(path.join(this.dir, "sheet.md"), "utf8").catch(() => "");
  }

  async writeSheet(md: string): Promise<void> {
    await writeAtomic(path.join(this.dir, "sheet.md"), `${md.trim()}\n`);
  }

  /** One line per disagreement between the material and the AI's knowledge (§9 "Ground"). */
  async appendConflict(c: { fragment: string; claim: string; resolution: string }, at = new Date()): Promise<void> {
    if (!isFragmentId(c.fragment)) throw new Error("Invalid fragment id");
    const file = path.join(this.dir, "conflicts.md");
    await fs.mkdir(this.dir, { recursive: true });
    const head = (await fs.stat(file).then(() => true, () => false)) ? "" : "# Material vs AI knowledge\n\n";
    await fs.appendFile(file, `${head}- ${at.toISOString().slice(0, 10)} [[frag:${c.fragment}]] ${cell(c.claim)} → ${cell(c.resolution)}\n`);
  }

  /** The scope's grounding mode when the person changed it; null: the harness's default. */
  async grounding(): Promise<GroundingMode | null> {
    const raw = await fs.readFile(path.join(this.dir, "grounding.json"), "utf8").catch(() => null);
    try {
      const mode = raw === null ? null : (JSON.parse(raw) as { mode?: unknown }).mode;
      return mode === "strict" || mode === "mixed" ? mode : null;
    } catch {
      return null;
    }
  }

  async setGrounding(mode: GroundingMode): Promise<void> {
    await writeAtomic(path.join(this.dir, "grounding.json"), `${JSON.stringify({ mode })}\n`);
  }
}
