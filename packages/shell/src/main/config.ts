import { promises as fs } from "node:fs";
import path from "node:path";
import type { AppConfig } from "@humanharness/ui";

/** Per-app settings in Electron's userData folder. The folder is fixed once chosen (spec §7). */
export class ConfigStore {
  private readonly file: string;

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

  async save(patch: AppConfig): Promise<AppConfig> {
    const current = await this.load();
    const next: AppConfig = { ...current, ...patch, ...(current.folder ? { folder: current.folder } : {}) };
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(next, null, 2));
    return next;
  }
}
