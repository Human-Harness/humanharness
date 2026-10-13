import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Backup status of the person's folder (spec 3d §2). Compliance: this module reads only paths (folder names
 * under ~/Library/CloudStorage, whether the iCloud Drive and ~/Dropbox folders exist, realpath) and
 * `.git/config` files. It never reads account, token or credential files, nor a provider's own settings.
 */

export type SyncProvider = "google-drive" | "onedrive" | "dropbox" | "icloud";
export type SyncStatus = { kind: "synced"; provider: SyncProvider } | { kind: "git-remote" } | { kind: "local" };

/** A synced place on this computer where a folder can live. */
export interface SyncLocation {
  provider: SyncProvider;
  path: string;
}

const ICLOUD = ["Library", "Mobile Documents", "com~apple~CloudDocs"];
const CLOUD_STORAGE = ["Library", "CloudStorage"];
/** Google Drive keeps the person's files in this folder of its drive (its top level only holds "My Drive", "Shared drives"…). */
const GOOGLE_MY_DRIVE = ["My Drive", "Mi unidad"];

// macOS file systems are usually case-insensitive: compare without case.
const lower = (p: string) => path.resolve(p).toLowerCase();
/** `child` is strictly inside `parent`. */
const strictlyInside = (child: string, parent: string) => lower(child).startsWith(lower(parent) + path.sep);
const isDir = (p: string) => fs.stat(p).then((s) => s.isDirectory(), () => false);

/** The provider of a folder name under ~/Library/CloudStorage. */
export function cloudProvider(name: string): SyncProvider | null {
  if (/^GoogleDrive-/i.test(name)) return "google-drive";
  if (/^OneDrive(-|$)/i.test(name)) return "onedrive";
  if (/^Dropbox(-|$)/i.test(name)) return "dropbox";
  return null;
}

/** The synced provider `folder` is in, judged by its path alone. */
export function providerOf(folder: string, home: string): SyncProvider | null {
  if (strictlyInside(folder, path.join(home, ...ICLOUD))) return "icloud";
  if (strictlyInside(folder, path.join(home, "Dropbox"))) return "dropbox";
  const cloud = path.join(home, ...CLOUD_STORAGE);
  if (!strictlyInside(folder, cloud)) return null;
  return cloudProvider(path.relative(lower(cloud), lower(folder)).split(path.sep)[0]);
}

/** Whether a git config has a `[remote "…"]` section with a `url`. */
export function hasRemote(config: string): boolean {
  let inRemote = false;
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const section = /^\[\s*([A-Za-z0-9.-]+)(\s+"[^"]*")?\s*\]/.exec(line);
    if (section) {
      inRemote = section[1].toLowerCase() === "remote" && section[2] !== undefined;
      continue;
    }
    if (inRemote && /^url\s*=\s*\S/i.test(line)) return true;
  }
  return false;
}

/**
 * Whether `folder`, or a folder above it, is a git repository with a remote. Reads only `<dir>/.git/config`,
 * and stops below the home folder: a dotfiles repository there doesn't back the folder up.
 */
export async function hasGitRemote(folder: string, home: string): Promise<boolean> {
  let dir = path.resolve(folder);
  for (;;) {
    if (lower(dir) === lower(home)) return false;
    const config = await fs.readFile(path.join(dir, ".git", "config"), "utf8").catch(() => null);
    if (config !== null) return hasRemote(config);
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/** How the folder is protected against losing the computer: a synced drive, a git remote, or nothing. */
export async function syncStatus(folder: string, home: string = os.homedir()): Promise<SyncStatus> {
  const real = await fs.realpath(folder).catch(() => folder);
  const provider = providerOf(real, home) ?? providerOf(folder, home);
  if (provider) return { kind: "synced", provider };
  return (await hasGitRemote(real, home)) ? { kind: "git-remote" } : { kind: "local" };
}

/** The synced places on this computer, found by folder names only. */
export async function syncLocations(home: string = os.homedir()): Promise<SyncLocation[]> {
  const found: SyncLocation[] = [];
  const cloud = path.join(home, ...CLOUD_STORAGE);
  const names = (await fs.readdir(cloud).catch(() => [] as string[])).sort();
  for (const name of names) {
    const provider = cloudProvider(name);
    const root = path.join(cloud, name);
    if (!provider || !(await isDir(root))) continue;
    if (provider !== "google-drive") {
      found.push({ provider, path: root });
      continue;
    }
    for (const mine of GOOGLE_MY_DRIVE) {
      if (await isDir(path.join(root, mine))) {
        found.push({ provider, path: path.join(root, mine) });
        break;
      }
    }
  }
  const dropbox = path.join(home, "Dropbox");
  if (!found.some((l) => l.provider === "dropbox") && (await isDir(dropbox))) found.push({ provider: "dropbox", path: dropbox });
  const icloud = path.join(home, ...ICLOUD);
  if (await isDir(icloud)) found.push({ provider: "icloud", path: icloud });
  return found;
}
