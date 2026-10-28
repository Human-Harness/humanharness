import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { JOB_ID, canonicalLanguage } from "@humanharness/harness-sdk";
import { type AppConfig, isTextSize } from "@humanharness/ui/client";
import { isProfileId } from "@humanharness/workspace";

/** Where the hidden history of `folder` lives: one gitdir per folder. */
export function historyDir(userData: string, folder: string): string {
  return path.join(userData, "history", createHash("sha256").update(folder).digest("hex").slice(0, 16));
}

/** A hand-edited `parallel` keeps only integer caps (parallel spec §7; parallelInfo clamps them to 1..8). */
function cleanParallel(v: unknown): AppConfig["parallel"] | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const out: { tasks?: number; jobs?: number } = {};
  if (Number.isInteger(o.tasks)) out.tasks = o.tasks as number;
  if (Number.isInteger(o.jobs)) out.jobs = o.jobs as number;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Settings › Jobs for one job, as the scheduler takes them: `off` only when true, a cap only as a whole number ≥ 1. */
export function cleanJobSettings(v: unknown): { off?: boolean; dailyTokens?: number } {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  const cap = o.dailyTokens;
  // 0 or a fraction would pause an `every` job for good, or count against a cap no run can meet.
  return { ...(o.off === true ? { off: true } : {}), ...(typeof cap === "number" && Number.isSafeInteger(cap) && cap >= 1 ? { dailyTokens: cap } : {}) };
}

/**
 * Settings › Jobs (parallel part 3): each job id's entry cleaned, an empty one left out; undefined when `v` is no
 * object. `declared` (the save's check) keeps only the harness's own jobs.
 */
export function cleanJobs(v: unknown, declared?: (id: string) => boolean): AppConfig["jobs"] | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const out: NonNullable<AppConfig["jobs"]> = {};
  for (const [id, entry] of Object.entries(v)) {
    if (!JOB_ID.test(id) || (declared && !declared(id))) continue;
    const kept = cleanJobSettings(entry);
    if (Object.keys(kept).length > 0) out[id] = kept;
  }
  return out;
}

/** Per-app settings in Electron's userData folder. The folder is fixed once chosen (spec §7). */
export class ConfigStore {
  private readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dir: string) {
    this.file = path.join(dir, "config.json");
  }

  async load(): Promise<AppConfig> {
    try {
      const saved = JSON.parse(await fs.readFile(this.file, "utf8")) as AppConfig;
      if (!saved || typeof saved !== "object") return saved;
      // Like a bad entry under models: a hand-edited backupDismissed, textSize or language of the wrong kind is dropped,
      // never a reason to treat the whole config as invalid.
      const { backupDismissed, textSize, language, profile, parallel, notifyWaiting, jobs, ...rest } = saved;
      const caps = cleanParallel(parallel);
      const jobSettings = cleanJobs(jobs);
      return {
        ...rest,
        ...(typeof backupDismissed === "boolean" ? { backupDismissed } : {}),
        ...(isTextSize(textSize) ? { textSize } : {}),
        ...(typeof language === "string" && canonicalLanguage(language) === language ? { language } : {}),
        ...(isProfileId(profile) ? { profile } : {}),
        ...(caps ? { parallel: caps } : {}),
        ...(typeof notifyWaiting === "boolean" ? { notifyWaiting } : {}),
        ...(jobSettings && Object.keys(jobSettings).length > 0 ? { jobs: jobSettings } : {}),
      };
    } catch {
      return {};
    }
  }

  /** Saves run one after another, and each write is atomic (temp file + rename). */
  save(patch: AppConfig): Promise<AppConfig> {
    const run = this.queue.then(() => this.saveNow(patch));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async saveNow(patch: AppConfig): Promise<AppConfig> {
    const current = await this.load();
    // The folder is fixed once chosen, and the active profile changes only through setProfile (a switch).
    const { profile: _ignored, ...rest } = patch;
    return this.write({
      ...current,
      ...rest,
      ...(current.folder ? { folder: current.folder } : {}),
      ...(current.profile ? { profile: current.profile } : {}),
    });
  }

  /**
   * Moving the folder (moveFolder) is the one way the fixed folder changes; queued with the other saves.
   * It stores `folder` as given: callers must validate it first (checkFolder).
   */
  replaceFolder(folder: string): Promise<AppConfig> {
    const run = this.queue.then(async () => this.write({ ...(await this.load()), folder }));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** The active profile (profiles spec §4): only a profile switch calls it. `undefined` clears it. Queued with the saves. */
  setProfile(id: string | undefined): Promise<AppConfig> {
    if (id !== undefined && !isProfileId(id)) return Promise.reject(new Error(`Invalid profile: "${id}"`));
    const run = this.queue.then(async () => {
      const { profile: _old, ...rest } = await this.load();
      return this.write(id === undefined ? rest : { ...rest, profile: id });
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Atomic: temp file + rename. */
  private async write(next: AppConfig): Promise<AppConfig> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(next, null, 2));
      await fs.rename(tmp, this.file);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
    return next;
  }
}
