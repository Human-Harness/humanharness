import { promises as fs } from "node:fs";
import path from "node:path";
import { GROUNDING_MODES, type GroundingMode, type HarnessMaterial } from "@humanharness/harness-sdk";
import {
  type ConvertRunner,
  MAX_BYTES,
  MaterialStore,
  type MeasuredCosts,
  type SourceEntry,
  addSource,
  confirmSource,
  isFragmentId,
  isSourceId,
  limitRunner,
  processSource,
  refusalText,
  workerRunner,
} from "@humanharness/material";
import { APP_SCOPE, MATERIAL_DIR, isScopeId } from "@humanharness/workspace";
import type { Fetched } from "./material-fetch";

/** One source as the window shows it (material spec §11). */
export interface MaterialSourceView {
  id: string;
  name: string;
  url?: string;
  status: SourceEntry["status"];
  stage?: SourceEntry["stage"];
  notice?: SourceEntry["notice"];
  refusal?: SourceEntry["refusal"];
  pages: number;
  rows?: number;
  pageRange?: [number, number];
  estimate: number;
  issues: string[];
  fixes: string[];
  fragments: number;
  verdict?: SourceEntry["verdict"];
  failed: boolean;
}

export interface MaterialView {
  scope: string;
  sources: MaterialSourceView[];
  grounding: { mode: GroundingMode; canChange: boolean };
  /** The engine's provider, for the privacy line (§13.3). */
  provider: string;
  /** The engine's usage window now, when it reports one (§7). */
  window: { kind: string; utilization: number } | null;
  /** Items with no fragment (Task 23); absent without `items`. */
  uncovered?: string[];
}

export type MaterialResult = { ok: true } | { ok: false; reason: "not-ready" | "unknown-scope" | "unknown-source" | "invalid" | "fetch" };
export type AddResult = { ok: true; added: string[]; refused: { name: string; message: string }[] } | { ok: false; reason: "not-ready" | "unknown-scope" | "fetch" };

export interface MaterialDeps {
  material: Pick<HarnessMaterial, "accepts" | "items" | "grounding" | "budget">;
  /** The current base (the active profile's folder, or the folder); null when the app isn't set up. */
  base(): Promise<string | null>;
  /** Registered and not archived (`main` without scopes). `_app` is never asked. */
  scopeOk(scope: string): Promise<boolean>;
  /** The main process's open dialog; null when cancelled. */
  pickFiles(): Promise<string[] | null>;
  fetchLink(url: string): Promise<Fetched>;
  send(channel: string, value: unknown): void;
  provider(): Promise<string>;
  window(): Promise<{ kind: string; utilization: number } | null>;
  /** After a change on disk: the queue looks for work (Task 17), the history records it. */
  afterChange(scope: string, what: string): Promise<void>;
  /**
   * Where files are converted and measured. Default: a worker thread per file (the TypeScript source through tsx,
   * for tests); the app passes the runner of its built worker entry. Either way at most CONVERT_AT_ONCE run at once.
   */
  runner?: ConvertRunner;
}

const view = (s: SourceEntry): MaterialSourceView => ({
  id: s.id,
  name: s.path,
  ...(s.url ? { url: s.url } : {}),
  status: s.status,
  ...(s.stage ? { stage: s.stage } : {}),
  ...(s.notice ? { notice: s.notice } : {}),
  ...(s.refusal ? { refusal: s.refusal } : {}),
  pages: s.pages,
  ...(s.rows !== undefined ? { rows: s.rows } : {}),
  ...(s.pageRange ? { pageRange: s.pageRange } : {}),
  estimate: s.estimate,
  issues: s.issues,
  fixes: s.fixes,
  fragments: s.fragments.length,
  ...(s.verdict ? { verdict: s.verdict } : {}),
  failed: s.failed !== undefined,
});

/**
 * The person's material (material spec §10, §11), in whatever base is current: with profiles each profile's folder
 * holds its own, and the base is asked on every call. Changes are sent to the window as `hh:materialStatus`.
 * One `MaterialStore` per base and scope, so every write to a registry goes through its one queue.
 */
export class MaterialService {
  private readonly runner: ConvertRunner;
  private readonly stores = new Map<string, MaterialStore>();
  /** Per base, once per run: finding the sources an earlier run left `converting` (awaited before any use of the base). */
  private readonly scans = new Map<string, Promise<void>>();
  /** Per base: converting those sources again (awaited only by `settle`). */
  private readonly resumes = new Map<string, Promise<void>>();

  constructor(private readonly d: MaterialDeps) {
    this.runner = limitRunner(d.runner ?? workerRunner());
  }

  /**
   * The one store of `base` and `scope`, unchecked: the caller passes a base it holds and a scope it checked (a running
   * task's). Everything that writes a registry (the window, the agent's tools, the queue) goes through it.
   */
  storeAt(base: string, scope: string): MaterialStore {
    const key = `${base}\0${scope}`;
    let store = this.stores.get(key);
    if (!store) {
      store = new MaterialStore(base, scope);
      this.stores.set(key, store);
    }
    return store;
  }

  /** The store of a scope in the current base, or why not. */
  async store(scope: unknown): Promise<MaterialStore | "not-ready" | "unknown-scope"> {
    if (typeof scope !== "string" || scope === APP_SCOPE || !isScopeId(scope)) return "unknown-scope";
    const base = await this.d.base();
    if (!base) return "not-ready";
    if (!(await this.d.scopeOk(scope))) return "unknown-scope";
    await this.scan(base);
    return this.storeAt(base, scope);
  }

  /**
   * Resumes the current base: sources an earlier run left `converting` (the app quit or crashed mid-way) are converted
   * again. At start and on a base's first use (a profile switch): each base once per run, so a conversion this run
   * started is never taken for a stuck one. Resolves when they are done.
   */
  async settle(): Promise<void> {
    const base = await this.d.base();
    if (!base) return;
    await this.scan(base);
    await this.resumes.get(base);
  }

  private scan(base: string): Promise<void> {
    let scan = this.scans.get(base);
    if (!scan) {
      scan = this.findStuck(base).then(
        (stuck) => void this.resumes.set(base, this.resume(stuck).catch((err: unknown) => console.error("Could not resume the material", err))),
        (err: unknown) => console.error("Could not look for unfinished material", err),
      );
      this.scans.set(base, scan);
    }
    return scan;
  }

  private async findStuck(base: string): Promise<{ store: MaterialStore; ids: string[] }[]> {
    const parent = path.join(base, ".harness", MATERIAL_DIR);
    const names = await fs.readdir(parent).catch(() => [] as string[]);
    const out: { store: MaterialStore; ids: string[] }[] = [];
    for (const scope of names) {
      if (!isScopeId(scope) || !(await this.d.scopeOk(scope))) continue;
      const store = this.storeAt(base, scope);
      const ids = (await store.sources().catch(() => [])).filter((s) => s.status === "converting").map((s) => s.id);
      if (ids.length > 0) out.push({ store, ids });
    }
    return out;
  }

  private async resume(stuck: { store: MaterialStore; ids: string[] }[]): Promise<void> {
    for (const { store, ids } of stuck) {
      for (const id of ids) {
        await processSource(store, id, this.pipeline());
        await this.d.afterChange(store.scope, `processed ${id}`).catch((err: unknown) => console.error("Could not record the material change", err));
      }
      await this.changed(store.scope).catch((err: unknown) => console.error("Could not show the material", err));
    }
  }

  async list(scope: string): Promise<MaterialView> {
    const store = await this.store(scope);
    const sources = typeof store === "string" ? [] : await store.sources();
    const chosen = typeof store === "string" ? null : await store.grounding();
    return {
      scope,
      sources: sources.filter((s) => s.status !== "removed").map(view),
      grounding: { mode: chosen ?? this.d.material.grounding.default, canChange: this.d.material.grounding.personCanChange },
      provider: await this.d.provider(),
      window: await this.d.window(),
    };
  }

  /** Sends the scope's view to the window. */
  async changed(scope: string): Promise<void> {
    this.d.send("hh:materialStatus", await this.list(scope));
  }

  private measured(): MeasuredCosts | undefined {
    return undefined; // Task 25: the averages measured in usage.jsonl.
  }

  /** What every pipeline call takes: items, the shared runner, the measured costs. */
  private pipeline() {
    const measured = this.measured();
    return { items: this.d.material.items !== undefined, runner: this.runner, ...(measured ? { measured } : {}) };
  }

  /** `client.material.add(scope)`: the file dialog, then intake of each file (§3, §7). */
  async add(scope: unknown): Promise<AddResult> {
    const store = await this.store(scope);
    if (typeof store === "string") return { ok: false, reason: store };
    const files = (await this.d.pickFiles()) ?? [];
    const added: string[] = [];
    const refused: { name: string; message: string }[] = [];
    for (const file of files) {
      const name = path.basename(file);
      // Past the hard limit the file isn't even read (§7).
      const stat = await fs.stat(file).catch(() => null);
      if (stat?.isFile() && stat.size > MAX_BYTES) {
        refused.push({ name, message: refusalText("too-big") });
        continue;
      }
      const data = stat?.isFile() ? await fs.readFile(file).catch(() => null) : null;
      if (!data) {
        refused.push({ name, message: "This file couldn't be read." });
        continue;
      }
      const r = await addSource(store, { name, data }, { accepts: this.d.material.accepts, ...this.pipeline() });
      if (r.ok) added.push(r.id);
      else refused.push({ name, message: r.message });
    }
    if (added.length > 0) await this.d.afterChange(store.scope, `added ${added.join(", ")}`);
    await this.changed(store.scope);
    return { ok: true, added, refused };
  }

  /** `client.material.addLink(scope, url)`: fetched now, then intake like a file (§3 Web). */
  async addLink(scope: unknown, url: unknown): Promise<AddResult> {
    const store = await this.store(scope);
    if (typeof store === "string") return { ok: false, reason: store };
    if (typeof url !== "string" || url.length > 2048) return { ok: false, reason: "fetch" };
    const page = await this.d.fetchLink(url);
    if (!page.ok) return { ok: false, reason: "fetch" };
    const r = await addSource(store, page, { accepts: this.d.material.accepts, ...this.pipeline() });
    if (r.ok) await this.d.afterChange(store.scope, `added ${r.id}`);
    await this.changed(store.scope);
    return r.ok ? { ok: true, added: [r.id], refused: [] } : { ok: true, added: [], refused: [{ name: page.name, message: r.message }] };
  }

  /** The person's answer to a waiting source (§7). */
  async confirm(scope: unknown, id: unknown, choice: unknown): Promise<MaterialResult> {
    const store = await this.store(scope);
    if (typeof store === "string") return { ok: false, reason: store };
    if (!isSourceId(id)) return { ok: false, reason: "unknown-source" };
    const c = typeof choice === "object" && choice !== null ? (choice as Record<string, unknown>) : {};
    const range =
      Array.isArray(c.pageRange) && c.pageRange.length === 2 && c.pageRange.every((n) => Number.isInteger(n) && (n as number) >= 1)
        ? (c.pageRange as [number, number])
        : undefined;
    const sheets = c.sheets === "summary" ? "summary" : Array.isArray(c.sheets) && c.sheets.every((s) => typeof s === "string") ? (c.sheets as string[]) : undefined;
    const next = await confirmSource(store, id, { ...(range ? { pageRange: range } : {}), ...(sheets ? { sheets } : {}) }, this.pipeline());
    if (!next) return { ok: false, reason: "invalid" };
    await this.d.afterChange(store.scope, `processed ${id}`);
    await this.changed(store.scope);
    return { ok: true };
  }

  /** §9 Ground: the scope's mode, when the harness lets the person change it. */
  async setGrounding(scope: unknown, mode: unknown): Promise<MaterialResult> {
    const store = await this.store(scope);
    if (typeof store === "string") return { ok: false, reason: store };
    if (!this.d.material.grounding.personCanChange || typeof mode !== "string" || !(GROUNDING_MODES as readonly string[]).includes(mode)) return { ok: false, reason: "invalid" };
    await store.setGrounding(mode as GroundingMode);
    await this.d.afterChange(store.scope, `grounding ${mode}`);
    await this.changed(store.scope);
    return { ok: true };
  }

  /**
   * The original a citation or a source line points at (§9): its path, only when it is a file inside the scope's
   * `material/` folder. The caller opens it.
   */
  async originalOf(scope: unknown, id: unknown): Promise<string | null> {
    const store = await this.store(scope);
    if (typeof store === "string" || !isSourceId(id)) return null;
    const sources = await store.sources();
    // A fragment id is also a valid source id (`fractions-001`): a source of that name first, then the fragment's source.
    const s = sources.find((x) => x.id === id) ?? (isFragmentId(id) ? sources.find((x) => x.fragments.includes(id)) : undefined);
    const file = s ? store.originalPath(s.path) : null;
    if (!file) return null;
    const stat = await fs.lstat(file).catch(() => null);
    return stat?.isFile() ? file : null;
  }
}
