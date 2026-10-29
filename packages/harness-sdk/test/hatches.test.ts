import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BACKEND_CALL_TIMEOUT_MS, BACKEND_EVENTS_PER_SECOND, BACKEND_LOG_MAX_BYTES, BACKEND_RESTARTS, BACKEND_STOP_GRACE_MS,
  defineHarness, hasBackend, hasEnginePresets, hasJobs, hasLinkedFolders, hatchProblems, isConcurrent, loadHarness, resolveInHarness,
} from "../src";

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
    ["a key outside the action-id pattern", { ...scoped, linkedFolders: { "Bad Key": repos } }, "must match pattern"],
    ["an unknown field (strict)", { ...scoped, linkedFolders: { repos: { ...repos, path: "/x" } } }, 'Unrecognized key: \\"path\\"'],
    ["a label over 40 characters", { ...scoped, linkedFolders: { repos: { ...repos, label: "x".repeat(41) } } }, "<=40 characters"],
    ["a label with a bidi override", { ...scoped, linkedFolders: { repos: { ...repos, label: "Repos\u202e" } } }, "hidden or control characters"],
    ["a label with a line separator", { ...scoped, linkedFolders: { repos: { ...repos, label: "A\u2028B" } } }, "hidden or control characters"],
    ["more than 8 keys", { ...scoped, linkedFolders: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, repos])) }, "At most 8 linked folder keys"],
  ])("refuses %s", (_name, manifest, message) => {
    expect(() => defineHarness(manifest as never)).toThrow(message);
  });

  it("an empty declaration counts as none", () => {
    expect(hasLinkedFolders(defineHarness({ ...scoped, linkedFolders: {} }))).toBe(false);
  });
});

describe("the hatches fixture harness (hatches part 1, e2e)", () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/hatches-harness");

  it("loads as a plain scoped harness with one write key of many folders", async () => {
    const h = await loadHarness(path.join(dir, "harness.config.ts"));
    expect(h.id).toBe("hatches");
    expect(h.scopes).toEqual({ label: "Project", plural: "Projects" });
    expect(h.permissions).toEqual({ edit: "folder", exec: false, web: false });
    expect(h.linkedFolders).toEqual({ repos });
    expect(hasLinkedFolders(h)).toBe(true);
    expect(hatchProblems(h)).toEqual([]);
    // Plain mode: no `parallel`, no jobs.
    expect(isConcurrent(h)).toBe(false);
    expect(hasJobs(h)).toBe(false);
    expect(Object.keys(h.actions)).toEqual(["implement"]);
  });

  it("has every file the app build needs", async () => {
    const h = await loadHarness(path.join(dir, "harness.config.ts"));
    expect(fs.readFileSync(resolveInHarness(h, h.actions.implement.prompt), "utf8")).toMatch(/^# Task: implement\n/);
    expect(fs.existsSync(resolveInHarness(h, h.instructions))).toBe(true);
    expect(fs.existsSync(path.join(dir, "ui", "App.tsx"))).toBe(true);
  });
});

describe("backend (hatches spec §4.1)", () => {
  it("D0: no backend key without one", () => {
    const h = defineHarness(base);
    expect("backend" in h).toBe(false);
    expect(hasBackend(h)).toBe(false);
  });

  it("takes a .ts, .mts, .js or .mjs path; no scopes needed", () => {
    for (const p of ["backend/index.ts", "backend/index.mts", "b.js", "b.mjs"]) {
      const h = defineHarness({ ...base, backend: p });
      expect(h.backend).toBe(p);
      expect(hasBackend(h)).toBe(true);
    }
  });

  it.each([
    ["", undefined],
    ["backend/index.tsx", "backend"],
    ["/abs/x.ts", "relative"],
    ["C:/x.ts", "relative"],
  ])("refuses %j", (p, message) => {
    const run = () => defineHarness({ ...base, backend: p });
    if (message) expect(run).toThrow(message);
    else expect(run).toThrow();
  });

  it("loadHarness refuses a backend outside the harness folder", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-backend-"));
    try {
      const file = path.join(dir, "harness.config.mjs");
      const manifest = { ...base, backend: "../escape.ts" };
      fs.writeFileSync(file, `export default ${JSON.stringify(manifest)};`);
      await expect(loadHarness(file)).rejects.toThrow("Path escapes the harness folder: ../escape.ts");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loadHarness keeps a backend inside the harness folder", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-backend-"));
    try {
      const file = path.join(dir, "harness.config.mjs");
      fs.writeFileSync(file, `export default ${JSON.stringify({ ...base, backend: "backend/index.ts" })};`);
      const h = await loadHarness(file);
      expect(resolveInHarness(h, h.backend!)).toBe(path.join(dir, "backend", "index.ts"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the limits main enforces", () => {
    expect(BACKEND_CALL_TIMEOUT_MS).toBe(30_000);
    expect(BACKEND_EVENTS_PER_SECOND).toBe(200);
    expect(BACKEND_RESTARTS).toEqual({ max: 3, windowMs: 5 * 60_000 });
    expect(BACKEND_STOP_GRACE_MS).toBe(3_000);
    expect(BACKEND_LOG_MAX_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe("enginePresets (hatches spec §5)", () => {
  it("D0: no enginePresets key without it", () => {
    const h = defineHarness(scoped);
    expect("enginePresets" in h).toBe(false);
    expect(hasEnginePresets(h)).toBe(false);
    expect(hatchProblems(h)).toEqual([]);
  });

  it("takes true only", () => {
    const h = defineHarness({ ...scoped, enginePresets: true });
    expect(h.enginePresets).toBe(true);
    expect(hasEnginePresets(h)).toBe(true);
    expect(() => defineHarness({ ...scoped, enginePresets: false as unknown as true })).toThrow();
    expect(() => defineHarness({ ...scoped, enginePresets: "yes" as unknown as true })).toThrow();
  });

  it("needs scopes", () => {
    expect(hatchProblems({ ...base, enginePresets: true }).map((p) => p.message)).toContain("enginePresets needs scopes");
    expect(hatchProblems({ ...base, enginePresets: true })[0]?.path).toEqual(["enginePresets"]);
    expect(() => defineHarness({ ...base, enginePresets: true })).toThrow(/enginePresets needs scopes/);
  });
});
