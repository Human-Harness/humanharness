import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { accountOf, cloudProvider, hasRemote, providerOf, syncLocations, syncStatus } from "../src";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hh-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

/** A fake home folder with these directories. */
function home(...dirs: string[]): string {
  const h = fs.mkdtempSync(path.join(root, "home-"));
  for (const d of dirs) fs.mkdirSync(path.join(h, d), { recursive: true });
  return h;
}
const gitConfig = (dir: string, text: string) => {
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".git", "config"), text);
};
const REMOTE = '[core]\n\tbare = false\n[remote "origin"]\n\turl = git@example.com:me/work.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n';

describe("providerOf", () => {
  const h = "/Users/ana";
  it("knows the synced roots by their path", () => {
    expect(providerOf("/Users/ana/Library/CloudStorage/GoogleDrive-ana@example.com/My Drive/Demo", h)).toBe("google-drive");
    expect(providerOf("/Users/ana/Library/CloudStorage/OneDrive-Personal/Demo", h)).toBe("onedrive");
    expect(providerOf("/Users/ana/Library/CloudStorage/Dropbox/Demo", h)).toBe("dropbox");
    expect(providerOf("/Users/ana/Dropbox/Demo", h)).toBe("dropbox");
    expect(providerOf("/Users/ana/Library/Mobile Documents/com~apple~CloudDocs/Demo", h)).toBe("icloud");
    expect(providerOf("/users/ANA/library/cloudstorage/googledrive-x/My Drive/Demo", h)).toBe("google-drive");
  });

  it("counts a synced root itself, the old Dropbox roots and every iCloud folder", () => {
    expect(providerOf("/Users/ana/Dropbox", h)).toBe("dropbox");
    expect(providerOf("/Users/ana/Dropbox (Personal)/Demo", h)).toBe("dropbox");
    expect(providerOf("/Users/ana/Dropbox (Acme Inc)", h)).toBe("dropbox");
    expect(providerOf("/Users/ana/Library/Mobile Documents/com~apple~CloudDocs", h)).toBe("icloud");
    expect(providerOf("/Users/ana/Library/Mobile Documents/iCloud~md~obsidian/Documents/Demo", h)).toBe("icloud");
    expect(providerOf("/Users/ana/Library/CloudStorage/Dropbox (Personal)/Demo", h)).toBe("dropbox");
    expect(providerOf("/Users/ana/Library/CloudStorage/OneDrive-Personal2", h)).toBe("onedrive");
  });

  it("compares names however their accents are encoded", () => {
    const nfd = "/Users/josé".normalize("NFD");
    expect(providerOf(`${nfd}/Dropbox/Demo`, "/Users/josé")).toBe("dropbox");
  });

  it("counts everything else as not synced, ~/Documents included (spike, Task 0)", () => {
    expect(providerOf("/Users/ana/Documents/Demo", h)).toBeNull();
    expect(providerOf("/Users/ana/Dropbox Old", h)).toBeNull();
    expect(providerOf("/Users/ana/Dropbox Old/Demo", h)).toBeNull();
    expect(providerOf("/Users/ana/Library/CloudStorage/Box-Box/Demo", h)).toBeNull();
    expect(providerOf("/Users/ana/Library/Mobile Documents", h)).toBeNull();
    expect(providerOf("/Volumes/Disk/Demo", h)).toBeNull();
  });

  it("reads provider folder names", () => {
    expect(cloudProvider("GoogleDrive-ana@example.com")).toBe("google-drive");
    expect(cloudProvider("OneDrive-Personal")).toBe("onedrive");
    expect(cloudProvider("OneDrive-Personal2")).toBe("onedrive");
    expect(cloudProvider("OneDrive")).toBe("onedrive");
    expect(cloudProvider("Dropbox-Team")).toBe("dropbox");
    expect(cloudProvider("Dropbox (Personal)")).toBe("dropbox");
    expect(cloudProvider("Box-Box")).toBeNull();
  });

  it("reads the account part of a provider's folder name", () => {
    expect(accountOf("GoogleDrive-ana@example.com")).toBe("ana@example.com");
    expect(accountOf("OneDrive-Personal2")).toBe("Personal2");
    expect(accountOf("Dropbox (Acme Inc)")).toBe("Acme Inc");
    expect(accountOf("Dropbox")).toBeUndefined();
  });
});

describe("hasRemote", () => {
  it("needs a remote section with a url", () => {
    expect(hasRemote(REMOTE)).toBe(true);
    expect(hasRemote('[Remote "o"]\nurl=https://example.com/x.git\n')).toBe(true);
    expect(hasRemote('[remote "origin"]\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n')).toBe(false);
    expect(hasRemote('[remote "origin"]\n[branch "main"]\n\turl = nope\n')).toBe(false);
    expect(hasRemote('# [remote "origin"]\n; url = x\n[core]\n')).toBe(false);
    expect(hasRemote("")).toBe(false);
  });
});

describe("syncStatus", () => {
  it("synced: under a provider's root", async () => {
    const h = home("Library/CloudStorage/GoogleDrive-ana@example.com/My Drive/Demo");
    expect(await syncStatus(path.join(h, "Library/CloudStorage/GoogleDrive-ana@example.com/My Drive/Demo"), h)).toEqual({ kind: "synced", provider: "google-drive" });
  });

  it("a link inside a synced root to a folder outside it is not synced", async () => {
    const h = home("Library/CloudStorage/Dropbox", "Elsewhere/Demo");
    const link = path.join(h, "Library/CloudStorage/Dropbox/Demo");
    fs.symlinkSync(path.join(h, "Elsewhere/Demo"), link);
    expect(await syncStatus(link, h)).toEqual({ kind: "local" });
  });

  it("a folder not created yet is judged by its path", async () => {
    const h = home("Dropbox");
    expect(await syncStatus(path.join(h, "Dropbox/Demo"), h)).toEqual({ kind: "synced", provider: "dropbox" });
  });

  it("git-remote: the folder or a folder above it has a remote", async () => {
    const h = home("Work/Repo/Demo", "Other/Demo");
    gitConfig(path.join(h, "Work/Repo"), REMOTE);
    expect(await syncStatus(path.join(h, "Work/Repo/Demo"), h)).toEqual({ kind: "git-remote" });
    gitConfig(path.join(h, "Other/Demo"), "[core]\n\tbare = false\n");
    expect(await syncStatus(path.join(h, "Other/Demo"), h)).toEqual({ kind: "local" });
  });

  it("the nearest repository decides, even when only its parent has a remote", async () => {
    const h = home("Work/Repo/Inner/Demo");
    gitConfig(path.join(h, "Work/Repo"), REMOTE);
    gitConfig(path.join(h, "Work/Repo/Inner"), "[core]\n\tbare = false\n");
    expect(await syncStatus(path.join(h, "Work/Repo/Inner/Demo"), h)).toEqual({ kind: "local" });
  });

  it("ignores a .git file pointer and keeps walking up", async () => {
    const h = home("Work/Repo/Sub/Demo");
    gitConfig(path.join(h, "Work/Repo"), REMOTE);
    fs.writeFileSync(path.join(h, "Work/Repo/Sub/.git"), "gitdir: /elsewhere/.git/worktrees/sub\n");
    expect(await syncStatus(path.join(h, "Work/Repo/Sub/Demo"), h)).toEqual({ kind: "git-remote" });
  });

  it("never follows a .git link", async () => {
    const h = home("Real/Demo", "Work/Demo");
    gitConfig(path.join(h, "Real"), REMOTE);
    fs.symlinkSync(path.join(h, "Real/.git"), path.join(h, "Work/.git"));
    expect(await syncStatus(path.join(h, "Work/Demo"), h)).toEqual({ kind: "local" });
  });

  it("reads no config that isn't a plain file of a sane size", async () => {
    const h = home("Dir/Demo", "Big/Demo");
    fs.mkdirSync(path.join(h, "Dir/.git/config"), { recursive: true });
    gitConfig(path.join(h, "Big"), REMOTE + "#".repeat(256 * 1024));
    const read = vi.spyOn(fs.promises, "readFile");
    expect(await syncStatus(path.join(h, "Dir/Demo"), h)).toEqual({ kind: "local" });
    expect(await syncStatus(path.join(h, "Big/Demo"), h)).toEqual({ kind: "local" });
    expect(read).not.toHaveBeenCalled();
  });

  it("walks up from a folder outside the home folder", async () => {
    const outside = fs.mkdtempSync(path.join(root, "vol-"));
    fs.mkdirSync(path.join(outside, "Repo/Demo"), { recursive: true });
    gitConfig(path.join(outside, "Repo"), REMOTE);
    expect(await syncStatus(path.join(outside, "Repo/Demo"), home())).toEqual({ kind: "git-remote" });
  });

  it("local: a dotfiles repository in the home folder doesn't back the folder up", async () => {
    const h = home("Documents/Demo");
    gitConfig(h, REMOTE);
    expect(await syncStatus(path.join(h, "Documents/Demo"), h)).toEqual({ kind: "local" });
  });

  it("reads nothing but .git/config files, and looks only at the folder's way up and the synced roots", async () => {
    const h = home("Work/Repo/Demo", ".claude", ".codex", ".gemini", "Library/CloudStorage/Dropbox", "Library/Mobile Documents/com~apple~CloudDocs");
    fs.writeFileSync(path.join(h, ".claude", "secret.json"), "{}");
    gitConfig(path.join(h, "Work/Repo"), REMOTE);
    const read = vi.spyOn(fs.promises, "readFile");
    const readdir = vi.spyOn(fs.promises, "readdir");
    const stat = vi.spyOn(fs.promises, "stat");
    const lstat = vi.spyOn(fs.promises, "lstat");
    expect(await syncStatus(path.join(h, "Work/Repo/Demo"), h)).toEqual({ kind: "git-remote" });
    await syncLocations(h);
    expect(read.mock.calls.length).toBeGreaterThan(0);
    for (const [file] of read.mock.calls) expect(String(file)).toMatch(/\/\.git\/config$/);
    expect(readdir.mock.calls.map(([d]) => String(d)).sort()).toEqual([h, path.join(h, "Library/CloudStorage")].sort());
    const looked = [...stat.mock.calls, ...lstat.mock.calls].map(([p]) => String(p));
    expect(looked.length).toBeGreaterThan(0);
    for (const p of looked) {
      expect(p).not.toMatch(/\/\.(claude|codex|gemini)(\/|$)/);
      expect(p).toMatch(/\/(\.git|\.git\/config|Library\/CloudStorage\/[^/]+(\/(My Drive|Mi unidad))?|Library\/Mobile Documents\/com~apple~CloudDocs|Dropbox[^/]*)$/);
    }
  });
});

describe("syncLocations", () => {
  it("lists the synced places on this computer, by folder names only", async () => {
    const h = home(
      "Library/CloudStorage/GoogleDrive-ana@example.com/My Drive",
      "Library/CloudStorage/GoogleDrive-work@example.com/Shared drives",
      "Library/CloudStorage/OneDrive-Personal",
      "Library/CloudStorage/Dropbox",
      "Library/CloudStorage/Box-Box",
      "Library/Mobile Documents/com~apple~CloudDocs",
    );
    expect(await syncLocations(h)).toEqual([
      { provider: "dropbox", path: path.join(h, "Library/CloudStorage/Dropbox") },
      { provider: "google-drive", path: path.join(h, "Library/CloudStorage/GoogleDrive-ana@example.com/My Drive"), account: "ana@example.com" },
      { provider: "onedrive", path: path.join(h, "Library/CloudStorage/OneDrive-Personal"), account: "Personal" },
      { provider: "icloud", path: path.join(h, "Library/Mobile Documents/com~apple~CloudDocs") },
    ]);
  });

  it("tells two accounts of one provider apart", async () => {
    const h = home("Library/CloudStorage/GoogleDrive-ana@example.com/My Drive", "Library/CloudStorage/GoogleDrive-work@example.com/My Drive");
    expect(await syncLocations(h)).toEqual([
      { provider: "google-drive", path: path.join(h, "Library/CloudStorage/GoogleDrive-ana@example.com/My Drive"), account: "ana@example.com" },
      { provider: "google-drive", path: path.join(h, "Library/CloudStorage/GoogleDrive-work@example.com/My Drive"), account: "work@example.com" },
    ]);
  });

  it("finds Google Drive's Spanish folder and the old ~/Dropbox", async () => {
    const h = home("Library/CloudStorage/GoogleDrive-ana@example.com/Mi unidad", "Dropbox");
    expect(await syncLocations(h)).toEqual([
      { provider: "google-drive", path: path.join(h, "Library/CloudStorage/GoogleDrive-ana@example.com/Mi unidad"), account: "ana@example.com" },
      { provider: "dropbox", path: path.join(h, "Dropbox") },
    ]);
  });

  it("finds the old Dropbox roots by name, and lists ~/Dropbox once when it links to the new one", async () => {
    const h = home("Library/CloudStorage/Dropbox", "Dropbox (Acme Inc)", "Dropbox Old");
    fs.symlinkSync(path.join(h, "Library/CloudStorage/Dropbox"), path.join(h, "Dropbox"));
    expect(await syncLocations(h)).toEqual([
      { provider: "dropbox", path: path.join(h, "Library/CloudStorage/Dropbox") },
      { provider: "dropbox", path: path.join(h, "Dropbox (Acme Inc)"), account: "Acme Inc" },
    ]);
  });

  it("is empty when nothing syncs", async () => {
    expect(await syncLocations(home("Documents"))).toEqual([]);
  });
});
