import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Backup status of the person's folder (spec 3d §2). Compliance: this module reads only paths (realpath,
 * stat/lstat), the names in the home folder and under ~/Library/CloudStorage, whether the synced roots exist,
 * and a folder's own `.git/config`. It never reads account, token or credential files, nor a provider's own
 * settings, and never anything under ~/.claude, ~/.codex or ~/.gemini.
 */

export type SyncProvider = "google-drive" | "onedrive" | "dropbox" | "icloud";
export type SyncStatus = { kind: "synced"; provider: SyncProvider } | { kind: "git-remote" } | { kind: "local" };

/** A synced place on this computer where a folder can live. */
export interface SyncLocation {
  provider: SyncProvider;
  path: string;
  /** Which account of the provider, from its folder name (`GoogleDrive-<account>`…), when the name says. */
  account?: string;
}

const MOBILE_DOCUMENTS = ["Library", "Mobile Documents"];
const ICLOUD = [...MOBILE_DOCUMENTS, "com~apple~CloudDocs"];
const CLOUD_STORAGE = ["Library", "CloudStorage"];
/** Google Drive keeps the person's files in this folder of its drive (its top level only holds "My Drive", "Shared drives"…). */
const GOOGLE_MY_DRIVE = ["My Drive", "Mi unidad"];
/** The old Dropbox roots in the home folder: `~/Dropbox`, `~/Dropbox (Personal)`, `~/Dropbox (Acme Inc)`. */
const LEGACY_DROPBOX = /^Dropbox( \([^)]+\))?$/i;
/** A `.git/config` bigger than this isn't one git wrote: it isn't read. */
const MAX_GIT_CONFIG = 256 * 1024;

// macOS file systems are usually case-insensitive and keep names as typed (NFC or NFD): compare without either.
const key = (p: string) => path.resolve(p).normalize("NFC").toLowerCase();
/** `child` is strictly inside `parent`. */
const strictlyInside = (child: string, parent: string) => key(child).startsWith(key(parent) + path.sep);
/** `child` is `parent` or inside it. */
const insideOrEqual = (child: string, parent: string) => key(child) === key(parent) || strictlyInside(child, parent);
/** The first name of `child` below `parent`, or null when it isn't strictly inside. */
const firstBelow = (child: string, parent: string) =>
  strictlyInside(child, parent) ? path.relative(key(parent), key(child)).split(path.sep)[0] : null;
const isDir = (p: string) => fs.stat(p).then((s) => s.isDirectory(), () => false);
const realOrNull = (p: string) => fs.realpath(p).catch(() => null);

/** The provider of a folder name under ~/Library/CloudStorage. */
export function cloudProvider(name: string): SyncProvider | null {
  if (/^GoogleDrive-/i.test(name)) return "google-drive";
  if (/^OneDrive(-|$)/i.test(name)) return "onedrive";
  // "Dropbox", "Dropbox-Team", "Dropbox (Personal)".
  if (/^Dropbox/i.test(name)) return "dropbox";
  return null;
}

/** The account part of a provider's folder name: after `GoogleDrive-`, `OneDrive-`, `Dropbox-`, or in `Dropbox (…)`. */
export function accountOf(name: string): string | undefined {
  const m = /^(?:GoogleDrive|OneDrive|Dropbox)-(.+)$/i.exec(name) ?? /^Dropbox \((.+)\)$/i.exec(name);
  return m ? m[1] : undefined;
}

/** The synced provider `folder` is in (a synced root itself counts), judged by its path alone. */
export function providerOf(folder: string, home: string): SyncProvider | null {
  if (insideOrEqual(folder, path.join(home, ...ICLOUD))) return "icloud";
  // Apps' own iCloud folders live next to iCloud Drive: synced too.
  if (strictlyInside(folder, path.join(home, ...MOBILE_DOCUMENTS))) return "icloud";
  const top = firstBelow(folder, home);
  if (top !== null && LEGACY_DROPBOX.test(top)) return "dropbox";
  const name = firstBelow(folder, path.join(home, ...CLOUD_STORAGE));
  return name === null ? null : cloudProvider(name);
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
 * The repository at `dir`: "none" when `dir/.git` isn't a real directory (missing, a symlink, or a worktree's
 * `.git` file), else whether its config names a remote. A config that isn't a plain file of a sane size counts
 * as no remote and is never read.
 */
async function repoAt(dir: string): Promise<"none" | boolean> {
  const git = path.join(dir, ".git");
  const gitStat = await fs.lstat(git).catch(() => null);
  if (!gitStat?.isDirectory()) return "none";
  const config = path.join(git, "config");
  const configStat = await fs.lstat(config).catch(() => null);
  if (!configStat?.isFile() || configStat.size > MAX_GIT_CONFIG) return false;
  const text = await fs.readFile(config, "utf8").catch(() => null);
  return text !== null && hasRemote(text);
}

/**
 * Whether `folder`, or a folder above it, is a git repository with a remote. The nearest repository decides
 * (a nested one isn't part of its parent's). Reads only `<dir>/.git/config`, and stops below the home folder:
 * a dotfiles repository there doesn't back the folder up.
 */
export async function hasGitRemote(folder: string, home: string): Promise<boolean> {
  let dir = path.resolve(folder);
  for (;;) {
    if (key(dir) === key(home)) return false;
    const repo = await repoAt(dir);
    if (repo !== "none") return repo;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/** How the folder is protected against losing the computer: a synced drive, a git remote, or nothing. */
export async function syncStatus(folder: string, home: string = os.homedir()): Promise<SyncStatus> {
  const realHome = (await realOrNull(home)) ?? home;
  const real = await realOrNull(folder);
  // A link is judged by where it points: a link inside a synced root to a folder outside it isn't synced.
  // The path as written only counts when it can't be resolved (a folder not created yet).
  const provider = real ? providerOf(real, realHome) : (providerOf(folder, home) ?? providerOf(folder, realHome));
  if (provider) return { kind: "synced", provider };
  return (await hasGitRemote(real ?? folder, real ? realHome : home)) ? { kind: "git-remote" } : { kind: "local" };
}

/** The synced places on this computer, found by folder names only. Two names for one place are listed once. */
export async function syncLocations(home: string = os.homedir()): Promise<SyncLocation[]> {
  const candidates: SyncLocation[] = [];
  const place = (provider: SyncProvider, p: string, name: string): SyncLocation => {
    const account = accountOf(name);
    return account ? { provider, path: p, account } : { provider, path: p };
  };
  const cloud = path.join(home, ...CLOUD_STORAGE);
  for (const name of (await fs.readdir(cloud).catch(() => [] as string[])).sort()) {
    const provider = cloudProvider(name);
    const root = path.join(cloud, name);
    if (!provider || !(await isDir(root))) continue;
    if (provider !== "google-drive") {
      candidates.push(place(provider, root, name));
      continue;
    }
    for (const mine of GOOGLE_MY_DRIVE) {
      if (await isDir(path.join(root, mine))) {
        candidates.push(place(provider, path.join(root, mine), name));
        break;
      }
    }
  }
  // The home folder's names only, for the old Dropbox roots.
  const legacy = (await fs.readdir(home).catch(() => [] as string[])).filter((n) => LEGACY_DROPBOX.test(n)).sort();
  for (const name of legacy) {
    if (await isDir(path.join(home, name))) candidates.push(place("dropbox", path.join(home, name), name));
  }
  const icloud = path.join(home, ...ICLOUD);
  if (await isDir(icloud)) candidates.push({ provider: "icloud", path: icloud });

  // ~/Dropbox is often a link to ~/Library/CloudStorage/Dropbox: one place, listed once.
  const found: SyncLocation[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const real = key((await realOrNull(c.path)) ?? c.path);
    if (seen.has(real)) continue;
    seen.add(real);
    found.push(c);
  }
  return found;
}
