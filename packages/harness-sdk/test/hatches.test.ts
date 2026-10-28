import { describe, expect, it } from "vitest";
import { defineHarness, hasLinkedFolders, hatchProblems } from "../src";

const base = {
  id: "t", name: "T", core: "^0.1.0", engines: ["claude"], folder: { suggested: "Documents/T" }, instructions: "./AGENTS.md",
  permissions: { edit: "folder" as const, exec: true, web: false }, blocks: {}, author: "x",
  actions: { implement: { label: "Implement", prompt: "./prompts/implement.md", cost: "medium" as const } },
};
const scoped = { ...base, scopes: { label: "Project", plural: "Projects" } };
const repos = { label: "Repos", mode: "write" as const, history: "auto" as const, many: true };

describe("linkedFolders (hatches spec §3.1)", () => {
  it("D0: a manifest without hatches parses to the same object", () => {
    const h = defineHarness(scoped);
    expect("linkedFolders" in h).toBe(false);
    expect(hasLinkedFolders(h)).toBe(false);
    expect(hatchProblems(h)).toEqual([]);
  });

  it("parses a declaration and fills the defaults", () => {
    const h = defineHarness({ ...scoped, linkedFolders: { repos, manuscript: { label: "Manuscript", mode: "read" } } });
    expect(h.linkedFolders?.repos).toEqual(repos);
    expect(h.linkedFolders?.manuscript).toEqual({ label: "Manuscript", mode: "read", history: "auto", many: false });
    expect(hasLinkedFolders(h)).toBe(true);
  });

  it.each([
    ["without scopes", { ...base, linkedFolders: { repos } }, "scopes"],
    ["write without permissions.edit folder", { ...scoped, permissions: { edit: "none", exec: false, web: false }, linkedFolders: { repos } }, "edit"],
    ["a key outside the action-id pattern", { ...scoped, linkedFolders: { "Bad Key": repos } }, undefined],
    ["an unknown field (strict)", { ...scoped, linkedFolders: { repos: { ...repos, path: "/x" } } }, undefined],
    ["a label over 40 characters", { ...scoped, linkedFolders: { repos: { ...repos, label: "x".repeat(41) } } }, undefined],
    ["more than 8 keys", { ...scoped, linkedFolders: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, repos])) }, undefined],
  ])("refuses %s", (_name, manifest, message) => {
    const run = () => defineHarness(manifest as never);
    if (message) expect(run).toThrow(message);
    else expect(run).toThrow();
  });

  it("an empty declaration counts as none", () => {
    expect(hasLinkedFolders(defineHarness({ ...scoped, linkedFolders: {} }))).toBe(false);
  });
});
