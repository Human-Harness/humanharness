import { promises as fs } from "node:fs";
import path from "node:path";
import { GROUNDING_MODES, type GroundingMode, type HarnessMaterial } from "@humanharness/harness-sdk";
import {
  type ConvertRunner,
  ConvertStopped,
  type Job,
  MAX_BYTES,
  MaterialStore,
  type MeasuredCosts,
  STAGES,
  type SourceEntry,
  type StageContext,
  type StageState,
  addSource,
  confirmSource,
  failStage,
  isFragmentId,
  isSourceId,
  jobKey,
  limitRunner,
  nextJob,
  processSource,
  refusalText,
  retryStage,
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
  material: Pick<HarnessMaterial, "accepts" | "items" | "grounding" | "budget" | "fragmentKinds" | "sheet" | "tiers">;
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
  /** Runs one stage session (runSystemTask with the stage's model); absent: stages can't run (tests). */
  runStage?(job: Job, prompt: string, tools: readonly string[], handle: (r: unknown) => Promise<unknown>, signal: AbortSignal): Promise<{ ok: boolean }>;
  /** Wakes the queue of AI stages. */
  kick?(): void;
}

/** A file not added because the app stopped converting (a profile switch, a folder or engine change, quitting). */
const STOPPED = "The app stopped before this file was added. Add it again.";

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
  /**
   * Bumped by `stop()`. Work started before a stop converts nothing more and neither records nor shows anything: its
   * base may no longer be the current one. What it left `converting` resumes on that base's next use.
   */
  private epoch = 0;
  /** Conversions under way (intake, answers, resumes): `stop()` waits for them. */
  private readonly inflight = new Set<Promise<unknown>>();
  /**
   * Jobs (`jobKey`) that ran since the last kick without moving on: a stage nobody registered yet, one with no way to
   * run, a scope stage that failed, an answer that left the source where it was. Skipped until the next kick, so the
   * queue never runs the same job in a loop.
   */
  private readonly skipped = new Set<string>();

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
        (stuck) => void this.resumes.set(base, this.track(this.resume(stuck)).catch((err: unknown) => console.error("Could not resume the material", err))),
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
    const epoch = this.epoch;
    for (const { store, ids } of stuck) {
      for (const id of ids) {
        if (epoch !== this.epoch) return;
        await processSource(store, id, this.pipeline(epoch));
        if (epoch !== this.epoch) return;
        await this.d.afterChange(store.scope, `processed ${id}`).catch((err: unknown) => console.error("Could not record the material change", err));
      }
      await this.changed(store.scope).catch((err: unknown) => console.error("Could not show the material", err));
    }
  }

  /** Keeps `work` among the conversions `stop()` waits for. */
  private track<T>(work: Promise<T>): Promise<T> {
    this.inflight.add(work);
    void work.finally(() => this.inflight.delete(work)).catch(() => undefined);
    return work;
  }

  /**
   * Stops every conversion under way (closeRuntime: a profile switch, an engine or folder change, a move, quitting) and
   * waits for them to unwind. Sources they left `converting` stay so, and every base is looked at afresh on its next
   * use (`settle`, or any call), so they resume there.
   */
  async stop(): Promise<void> {
    this.epoch++;
    this.runner.stop?.();
    await Promise.allSettled([...this.inflight]);
    this.scans.clear();
    this.resumes.clear();
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

  /**
   * What every pipeline call takes: items, the shared runner, the measured costs. `epoch`: the work's; once a stop has
   * come since, the runner refuses to start anything (`ConvertStopped`), so nothing more is converted for it.
   */
  private pipeline(epoch: number) {
    const measured = this.measured();
    const live = <T>(job: () => Promise<T>): Promise<T> => (epoch === this.epoch ? job() : Promise.reject(new ConvertStopped()));
    const runner: ConvertRunner = {
      convert: (type, data, opts) => live(() => this.runner.convert(type, data, opts)),
      measure: (type, data, name, link) => live(() => this.runner.measure(type, data, name, link)),
    };
    return { items: this.d.material.items !== undefined, runner, ...(measured ? { measured } : {}) };
  }

  /** `client.material.add(scope)`: the file dialog, then intake of each file (§3, §7). */
  async add(scope: unknown): Promise<AddResult> {
    const epoch = this.epoch;
    const store = await this.store(scope);
    if (typeof store === "string") return { ok: false, reason: store };
    const files = (await this.d.pickFiles()) ?? [];
    // The base may have changed while the dialog was open.
    if (epoch !== this.epoch) return { ok: false, reason: "not-ready" };
    return this.track(this.addFiles(store, files, epoch));
  }

  private async addFiles(store: MaterialStore, files: string[], epoch: number): Promise<AddResult> {
    const added: string[] = [];
    const refused: { name: string; message: string }[] = [];
    for (const file of files) {
      const name = path.basename(file);
      if (epoch !== this.epoch) {
        refused.push({ name, message: STOPPED });
        continue;
      }
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
      const r = await addSource(store, { name, data }, { accepts: this.d.material.accepts, ...this.pipeline(epoch) });
      if (r.ok) added.push(r.id);
      else refused.push({ name, message: epoch === this.epoch ? r.message : STOPPED });
    }
    if (epoch !== this.epoch) return { ok: true, added, refused };
    if (added.length > 0) await this.d.afterChange(store.scope, `added ${added.join(", ")}`);
    await this.changed(store.scope);
    return { ok: true, added, refused };
  }

  /** `client.material.addLink(scope, url)`: fetched now, then intake like a file (§3 Web). */
  async addLink(scope: unknown, url: unknown): Promise<AddResult> {
    const epoch = this.epoch;
    const store = await this.store(scope);
    if (typeof store === "string") return { ok: false, reason: store };
    if (typeof url !== "string" || url.length > 2048) return { ok: false, reason: "fetch" };
    const page = await this.d.fetchLink(url);
    if (!page.ok) return { ok: false, reason: "fetch" };
    if (epoch !== this.epoch) return { ok: false, reason: "not-ready" };
    const r = await this.track(addSource(store, page, { accepts: this.d.material.accepts, ...this.pipeline(epoch) }));
    if (epoch !== this.epoch) return r.ok ? { ok: true, added: [r.id], refused: [] } : { ok: true, added: [], refused: [{ name: page.name, message: STOPPED }] };
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
    const epoch = this.epoch;
    const next = await this.track(confirmSource(store, id, { ...(range ? { pageRange: range } : {}), ...(sheets ? { sheets } : {}) }, this.pipeline(epoch)));
    // Stopped half-way: it resumes when its base is next used.
    if (epoch !== this.epoch) return { ok: false, reason: "not-ready" };
    if (!next) return { ok: false, reason: "invalid" };
    await this.d.afterChange(store.scope, `processed ${id}`);
    await this.changed(store.scope);
    return { ok: true };
  }

  /** The next AI stage in the current base, over every scope that has material (spec §10). */
  async nextJob(): Promise<Job | null> {
    const base = await this.d.base();
    if (!base) return null;
    const scopes = await fs.readdir(path.join(base, ".harness", MATERIAL_DIR)).catch(() => [] as string[]);
    for (const scope of scopes.sort()) {
      const store = await this.store(scope);
      if (typeof store === "string") continue;
      const job = await nextJob(store, { items: this.d.material.items !== undefined, skip: (j) => this.skipped.has(jobKey(j)) });
      if (job) return job;
    }
    return null;
  }

  /**
   * Runs one job: the stage's session, then its answers applied; a failure marks the source (§13). A job that can't
   * run (a stage nobody registered yet, no way to run one) or didn't move on is skipped until the next kick.
   */
  async runJob(job: Job, signal: AbortSignal): Promise<void> {
    const store = await this.store(job.scope);
    const def = Object.hasOwn(STAGES, job.stage) ? STAGES[job.stage] : undefined;
    if (typeof store === "string" || !def || !this.d.runStage) {
      this.skipped.add(jobKey(job));
      return;
    }
    const ctx = await this.stageContext(job, store);
    const prompt = await def.prompt(store, job, ctx);
    // The source once the prompt is set (it may queue a batch): a stage that changed it since has moved on.
    const before = job.source ? JSON.stringify(await store.source(job.source)) : null;
    const state: StageState = { store, job, answers: [] };
    let ok: boolean;
    if (prompt !== null) {
      const handle = async (request: unknown) => {
        const r = typeof request === "object" && request !== null ? (request as Record<string, unknown>) : {};
        if (r.op === "read" && isFragmentId(r.id)) {
          const f = await store.readFragment(r.id);
          if (!f) throw new Error(`No fragment ${r.id.slice(0, 80)}`);
          return f.md;
        }
        if (typeof r.op === "string" && def.tools.includes(r.op)) {
          const { op, ...args } = r;
          return def.accept(op, args, state);
        }
        throw new Error("Unknown request");
      };
      const result = await this.d.runStage(job, prompt, def.tools, handle, signal);
      // Stopped by closeRuntime: the stage runs again later, from the start.
      if (signal.aborted) return;
      ok = result.ok && (await def.apply(store, job, state, ctx));
    } else ok = await def.apply(store, job, state, ctx);
    if (!ok) await failStage(store, job);
    // The scope's stages in order (§10): a sheet done hands over to the links (with items); links done clear the marker.
    if (ok && job.stage === "sheet") await store.setStale(this.d.material.items !== undefined ? "link" : false);
    if (ok && job.stage === "link") await store.setStale(false);
    // Still the same job (a scope stage that failed, an answer that left the source as it was): not again until a kick.
    // A source still at its stage but changed (its next batch queued: review, labels) runs on.
    const after = job.source ? await store.source(job.source) : null;
    const same = job.source ? after?.status === "validating" && after.stage === job.stage && JSON.stringify(after) === before : (await store.stale()) === job.stage;
    if (same) this.skipped.add(jobKey(job));
    await this.changed(job.scope);
  }

  /**
   * What prompts need from the manifest (Tasks 21–23 add the items), and for a source's job how to convert it again
   * (§6.2 `reconvert`: the review starts over on the new fragments).
   */
  async stageContext(job: Job, store: MaterialStore): Promise<StageContext> {
    const source = job.source;
    return {
      fragmentKinds: [...this.d.material.fragmentKinds],
      sheetSections: this.d.material.sheet.sections.map((s) => ({ id: s.id, label: s.label, prompt: s.prompt })),
      sheetMaxTokens: this.d.material.sheet.maxTokens,
      ...(source
        ? {
            reconvert: async (settings) => {
              const epoch = this.epoch;
              await this.track(processSource(store, source, { ...this.pipeline(epoch), settings }));
              if (epoch === this.epoch) await this.d.afterChange(store.scope, `processed ${source}`).catch((err: unknown) => console.error("Could not record the material change", err));
            },
          }
        : {}),
    };
  }

  /** A kick: the jobs skipped since the last one may run again. */
  resetFailures(): void {
    this.skipped.clear();
  }

  /** Try again (§11): the failed stage runs once more. */
  async retry(scope: unknown, id: unknown): Promise<MaterialResult> {
    const store = await this.store(scope);
    if (typeof store === "string") return { ok: false, reason: store };
    if (!isSourceId(id) || !(await retryStage(store, id))) return { ok: false, reason: "unknown-source" };
    this.d.kick?.();
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
