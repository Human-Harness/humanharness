import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AppConfig } from "@humanharness/ui";

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
      return JSON.parse(await fs.readFile(this.file, "utf8")) as AppConfig;
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
    const next: AppConfig = { ...current, ...patch, ...(current.folder ? { folder: current.folder } : {}) };
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
