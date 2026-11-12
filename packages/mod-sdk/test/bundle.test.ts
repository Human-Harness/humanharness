import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundleMod, SHARED_IMPORTS } from "../src/bundle";

let tmp: string;
let dir: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hh-bundle-"));
  dir = path.join(tmp, "mod");
  await fs.mkdir(dir);
});
afterEach(() => fs.rm(tmp, { recursive: true, force: true }));

const write = async (rel: string, text: string) => {
  await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await fs.writeFile(path.join(dir, rel), text);
};

describe("bundleMod", () => {
  it("lists the shared imports a mod may use", () => {
    expect([...SHARED_IMPORTS].sort()).toEqual(["@humanharness/mod-sdk", "@humanharness/ui", "react", "react/jsx-runtime", "zod"]);
  });

  it("builds a main entry that imports zod and a relative file; zod comes from the path given", async () => {
    // A stand-in for the app's copy of zod, so the built file can be imported and run.
    const fakeZod = path.join(tmp, "app-zod.mjs");
    await fs.writeFile(fakeZod, "export const z = { tag: 'app zod' };\n");
    await write("lib/word.ts", "export const word: string = 'pong';\n");
    await write("main.ts", "import { z } from 'zod';\nimport { word } from './lib/word';\nexport default { id: 'echo', word, tag: z.tag };\n");
    const outFile = path.join(tmp, "build", "main.mjs");
    const r = await bundleMod({ dir, entry: "main.ts", part: "main", outFile, resolveShared: (s) => (s === "zod" ? fakeZod : `/nowhere/${s}`) });
    expect(r).toEqual({ ok: true });
    const out = await fs.readFile(outFile, "utf8");
    expect(out).toContain(pathToFileURL(fakeZod).href);
    expect(out).toContain("pong");
    const mod = (await import(pathToFileURL(outFile).href)) as { default: { id: string; word: string; tag: string } };
    expect(mod.default).toEqual({ id: "echo", word: "pong", tag: "app zod" });
  });

  it("builds a ui entry using react without React inside: shared imports read globalThis.__hhModules", async () => {
    await write("ui.tsx", "import { useState } from 'react';\nexport function Panel() { const [n] = useState(1); return <div>{n}</div>; }\n");
    const outFile = path.join(tmp, "build", "ui.js");
    const r = await bundleMod({ dir, entry: "ui.tsx", part: "ui", outFile, resolveShared: () => "/unused" });
    expect(r).toEqual({ ok: true });
    const out = await fs.readFile(outFile, "utf8");
    expect(out).toContain("__hhModules");
    expect(out).toContain('"react/jsx-runtime"');
    expect(out).not.toMatch(/react\.production|react\.development|ReactCurrentOwner|__SECRET_INTERNALS/);
    expect(out).not.toMatch(/^\s*import\s/m);
    // It runs against whatever the window put in __hhModules.
    const g = globalThis as { __hhModules?: Record<string, unknown> };
    g.__hhModules = {
      react: { useState: (v: unknown) => [v, () => undefined] },
      "react/jsx-runtime": { jsx: (type: string, props: { children: unknown }) => ({ type, children: props.children }) },
    };
    try {
      const mod = (await import(pathToFileURL(outFile).href)) as { Panel: () => unknown };
      expect(mod.Panel()).toEqual({ type: "div", children: 1 });
    } finally {
      delete g.__hhModules;
    }
  });

  it("refuses any other bare import with the file, line and what a mod may import", async () => {
    await write("main.ts", "// a comment\nimport _ from 'lodash';\nexport default _;\n");
    const r = await bundleMod({ dir, entry: "main.ts", part: "main", outFile: path.join(tmp, "out.mjs"), resolveShared: (s) => `/app/${s}` });
    expect(r).toEqual({
      ok: false,
      problems: ["main.ts:2: lodash can't be imported by a mod; use react, @humanharness/ui, @humanharness/mod-sdk, zod or a file in the mod's folder"],
    });
  });

  it("refuses node built-ins too", async () => {
    await write("main.ts", "import fs from 'node:fs';\nexport default fs;\n");
    const r = await bundleMod({ dir, entry: "main.ts", part: "main", outFile: path.join(tmp, "out.mjs"), resolveShared: (s) => `/app/${s}` });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problems[0]).toMatch(/^main\.ts:1: node:fs can't be imported by a mod/);
  });

  it("refuses a relative import that leaves the mod's folder", async () => {
    await fs.writeFile(path.join(tmp, "x.ts"), "export const x = 1;\n");
    await write("sub/main.ts", "import { x } from '../../x';\nexport default x;\n");
    const r = await bundleMod({ dir, entry: "sub/main.ts", part: "main", outFile: path.join(tmp, "out.mjs"), resolveShared: (s) => `/app/${s}` });
    expect(r).toEqual({ ok: false, problems: ["sub/main.ts:1: ../../x can't be imported by a mod; use react, @humanharness/ui, @humanharness/mod-sdk, zod or a file in the mod's folder"] });
  });

  it("allows ../ that stays inside the folder", async () => {
    await write("lib/a.ts", "export const a = 1;\n");
    await write("sub/main.ts", "import { a } from '../lib/a';\nexport default a;\n");
    const r = await bundleMod({ dir, entry: "sub/main.ts", part: "main", outFile: path.join(tmp, "out.mjs"), resolveShared: (s) => `/app/${s}` });
    expect(r).toEqual({ ok: true });
  });

  it("returns a syntax error with its line", async () => {
    await write("main.ts", "export const a = 1;\nexport const b = ;\n");
    const r = await bundleMod({ dir, entry: "main.ts", part: "main", outFile: path.join(tmp, "out.mjs"), resolveShared: (s) => `/app/${s}` });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problems[0]).toMatch(/^main\.ts:2: /);
  });

  it("a missing entry is a problem, not a throw", async () => {
    const r = await bundleMod({ dir, entry: "main.ts", part: "main", outFile: path.join(tmp, "out.mjs"), resolveShared: (s) => `/app/${s}` });
    expect(r.ok).toBe(false);
  });
});
