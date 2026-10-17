import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { type AppConfig, isTextSize } from "@humanharness/ui/client";

/** Where the hidden history of `folder` lives: one gitdir per folder. */
export function historyDir(userData: string, folder: string): string {
  return path.join(userData, "history", createHash("sha256").update(folder).digest("hex").slice(0, 16));
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
      // Like a bad entry under models: a hand-edited backupDismissed or textSize of the wrong kind is dropped,
      // never a reason to treat the whole config as invalid.
      const { backupDismissed, textSize, ...rest } = saved;
      return {
        ...rest,
        ...(typeof backupDismissed === "boolean" ? { backupDismissed } : {}),
        ...(isTextSize(textSize) ? { textSize } : {}),
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
    return this.write({ ...current, ...patch, ...(current.folder ? { folder: current.folder } : {}) });
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
