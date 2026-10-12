import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { appSourceDir, displayPath, homeOrDotFolder, referenceAllowed, resolveReferences, usableReferences } from "../src/main/references";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hh-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const label = { es: "Código", en: "Source" };
const repo = path.join(root, "repo");
fs.mkdirSync(path.join(repo, "harnesses", "demo"), { recursive: true });
fs.writeFileSync(path.join(repo, "pnpm-workspace.yaml"), "packages: []\n");
const home = path.join(root, "home");
fs.mkdirSync(path.join(home, "code", "docs"), { recursive: true });
const allowAll = { allowed: () => true };

describe("appSourceDir", () => {
  it("walks up from the harness folder to the workspace root", async () => {
    expect(await appSourceDir(path.join(repo, "harnesses", "demo"))).toBe(repo);
    expect(await appSourceDir(path.join(root, "home"))).toBeNull();
  });
});

describe("resolveReferences", () => {
  it("resolves app-source in development and ~/ paths; drops what is missing or packaged", async () => {
    const refs = [
      { id: "source", label, default: "app-source" },
      { id: "docs", label, default: "~/code/docs" },
      { id: "gone", label, default: "~/nowhere" },
    ];
    const dev = await resolveReferences(refs, { harnessDir: path.join(repo, "harnesses", "demo"), home, packaged: false, ...allowAll });
    expect(dev).toEqual([
      { id: "source", label, path: repo },
      { id: "docs", label, path: path.join(home, "code", "docs") },
    ]);
    const packaged = await resolveReferences(refs, { harnessDir: path.join(repo, "harnesses", "demo"), home, packaged: true, ...allowAll });
    expect(packaged.map((r) => r.id)).toEqual(["docs"]);
  });

  it("refuses folders the agent must never read, by default", async () => {
    const refs = [{ id: "x", label, default: "~/code/docs" }];
    const refused = await resolveReferences(refs, { harnessDir: repo, home, packaged: false, allowed: () => false });
    expect(refused).toEqual([]);
  });
});

describe("resolveReferences: real paths", () => {
  it("refuses a link that leads into a dot-folder of the home, comparing real paths", async () => {
    fs.mkdirSync(path.join(home, ".ssh"), { recursive: true });
    fs.symlinkSync(path.join(home, ".ssh"), path.join(home, "code", "keys"));
    const homeLink = path.join(root, "home-link");
    fs.symlinkSync(home, homeLink);
    const refs = [{ id: "keys", label, default: "~/code/keys" }, { id: "ssh", label, default: "~/.ssh" }, { id: "docs", label, default: "~/code/docs" }];
    // The temporary folder is under /private, a system folder: only the home rule is checked here.
    const out = await resolveReferences(refs, { harnessDir: repo, home: homeLink, packaged: false, allowed: (dir, h) => !homeOrDotFolder(dir, h) });
    expect(out.map((r) => r.id)).toEqual(["docs"]);
  });
});

describe("referenceAllowed", () => {
  it("allows a project folder and refuses credentials, system folders and the whole home", () => {
    expect(referenceAllowed("/Users/me/code/humanharness", "/Users/me")).toBe(true);
    expect(referenceAllowed("/Users/me/.claude", "/Users/me")).toBe(false);
    expect(referenceAllowed("/Users/me/.codex/sessions", "/Users/me")).toBe(false);
    expect(referenceAllowed("/Users/me", "/Users/me")).toBe(false);
    expect(referenceAllowed("/etc", "/Users/me")).toBe(false);
    expect(referenceAllowed("/Users/me/code/a,b", "/Users/me")).toBe(false);
  });

  it("refuses every dot-folder directly in the home folder and anything inside one, whatever the case", () => {
    for (const dir of [".gemini", ".ssh", ".aws/creds", ".config/gh", ".gnupg", ".GEMINI", ".Ssh/keys", ".kube"]) {
      expect(referenceAllowed(`/Users/me/${dir}`, "/Users/me")).toBe(false);
    }
    expect(referenceAllowed("/USERS/ME", "/Users/me")).toBe(false);
    expect(referenceAllowed("/Users/me/code/.hidden", "/Users/me")).toBe(true);
    expect(referenceAllowed("/Users/me/..foo", "/Users/me")).toBe(false);
    expect(referenceAllowed("/Users/other/.ssh", "/Users/me")).toBe(true);
  });
});

describe("displayPath", () => {
  it("shortens paths in the home folder", () => {
    expect(displayPath("/Users/me/code/hh", "/Users/me")).toBe("~/code/hh");
    expect(displayPath("/opt/x", "/Users/me")).toBe("/opt/x");
  });
});

describe("usableReferences", () => {
  const work = path.join(repo, "work");
  fs.mkdirSync(work, { recursive: true });
  const docs = { id: "docs", label, path: path.join(home, "code", "docs") };

  it("refuses a reference folder that is or contains the working folder, saying why", async () => {
    const refused: string[] = [];
    const refs = [{ id: "source", label, path: repo }, { id: "same", label, path: work }, docs];
    expect(await usableReferences(refs, work, (message) => refused.push(message))).toEqual([docs]);
    expect(refused).toEqual([
      `The reference folder "source" (${repo}) contains the working folder ${work}: it is left out, so the agent can still change your files.`,
      `The reference folder "same" (${work}) contains the working folder ${work}: it is left out, so the agent can still change your files.`,
    ]);
  });

  it("compares real paths: a working folder reached through a link is still caught", async () => {
    const link = path.join(root, "work-link");
    fs.symlinkSync(work, link);
    expect(await usableReferences([{ id: "source", label, path: repo }], link)).toEqual([]);
    expect(await usableReferences([{ id: "source", label, path: repo }], path.join(home, "new-folder"))).toHaveLength(1);
  });
});
