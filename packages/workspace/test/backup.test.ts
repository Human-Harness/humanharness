import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cloudProvider, hasRemote, providerOf, syncLocations, syncStatus } from "../src";

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

  it("counts everything else as not synced, ~/Documents included (spike, Task 0)", () => {
    expect(providerOf("/Users/ana/Documents/Demo", h)).toBeNull();
    expect(providerOf("/Users/ana/Library/CloudStorage/Box-Box/Demo", h)).toBeNull();
    expect(providerOf("/Users/ana/Library/Mobile Documents/com~apple~CloudDocs", h)).toBeNull();
    expect(providerOf("/Volumes/Disk/Demo", h)).toBeNull();
  });

  it("reads provider folder names", () => {
    expect(cloudProvider("GoogleDrive-ana@example.com")).toBe("google-drive");
    expect(cloudProvider("OneDrive-Personal")).toBe("onedrive");
    expect(cloudProvider("OneDrive")).toBe("onedrive");
    expect(cloudProvider("Dropbox-Team")).toBe("dropbox");
    expect(cloudProvider("Box-Box")).toBeNull();
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

  it("git-remote: the folder or a folder above it has a remote", async () => {
    const h = home("Work/Repo/Demo", "Other/Demo");
    gitConfig(path.join(h, "Work/Repo"), REMOTE);
    expect(await syncStatus(path.join(h, "Work/Repo/Demo"), h)).toEqual({ kind: "git-remote" });
    gitConfig(path.join(h, "Other/Demo"), "[core]\n\tbare = false\n");
    expect(await syncStatus(path.join(h, "Other/Demo"), h)).toEqual({ kind: "local" });
  });

  it("local: a dotfiles repository in the home folder doesn't back the folder up", async () => {
    const h = home("Documents/Demo");
    gitConfig(h, REMOTE);
    expect(await syncStatus(path.join(h, "Documents/Demo"), h)).toEqual({ kind: "local" });
  });

  it("reads nothing but .git/config files", async () => {
    const h = home("Documents/Demo", ".claude");
    fs.writeFileSync(path.join(h, ".claude", "secret.json"), "{}");
    const read = vi.spyOn(fs.promises, "readFile");
    await syncStatus(path.join(h, "Documents/Demo"), h);
    await syncLocations(h);
    for (const [file] of read.mock.calls) expect(String(file)).toMatch(/\/\.git\/config$/);
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
      { provider: "google-drive", path: path.join(h, "Library/CloudStorage/GoogleDrive-ana@example.com/My Drive") },
      { provider: "onedrive", path: path.join(h, "Library/CloudStorage/OneDrive-Personal") },
      { provider: "icloud", path: path.join(h, "Library/Mobile Documents/com~apple~CloudDocs") },
    ]);
  });

  it("finds Google Drive's Spanish folder and the old ~/Dropbox", async () => {
    const h = home("Library/CloudStorage/GoogleDrive-ana@example.com/Mi unidad", "Dropbox");
    expect(await syncLocations(h)).toEqual([
      { provider: "google-drive", path: path.join(h, "Library/CloudStorage/GoogleDrive-ana@example.com/Mi unidad") },
      { provider: "dropbox", path: path.join(h, "Dropbox") },
    ]);
  });

  it("is empty when nothing syncs", async () => {
    expect(await syncLocations(home("Documents"))).toEqual([]);
  });
});
