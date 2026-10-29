import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parsePluginManifest } from "@humanharness/harness-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliError } from "../src/cli";
import { buildPlugin, panelHtml } from "../src/plugin-build";
import { tempRoot } from "./helpers";

const CONFIG = `import { definePlugin, z } from "@humanharness/harness-sdk";

export default definePlugin({
  id: "mini",
  name: "Mini",
  version: "0.1.0",
  harness: "*",
  permissions: { hosts: ["api.example.com"], tasks: true },
  sources: [{ id: "items", ttl: 900 }],
  data: { items: { key: "id", agent: "read", schema: z.object({ id: z.string(), title: z.string().max(200) }) } },
  panels: [{ id: "main", title: "Mini" }],
  chips: [{ id: "count" }],
  actions: [{ id: "sum", label: "Summarize", tier: "light", scope: "none", vars: z.object({ title: z.string() }), prompt: "Summarize {{title}}." }],
});
`;

const BACKEND = `import { definePluginBackend } from "@humanharness/harness-sdk/plugin-backend";

export default definePluginBackend({
  sources: {
    async items(ctx) {
      const res = await ctx.fetch("https://api.example.com/items");
      await ctx.data.replaceAll("items", res.json() as { id: string; title: string }[]);
    },
  },
});
`;

const PANEL = `import { Table, useQuery } from "@humanharness/plugin-ui";
import "./main.css";

export default function Main() {
  const q = useQuery<{ id: string; title: string }>("items");
  return <Table rows={q.records} columns={[{ key: "title", label: "Title" }]} />;
}
`;

function writePlugin(dir: string, files: Record<string, string> = {}) {
  const all = { "plugin.config.ts": CONFIG, "backend.ts": BACKEND, "panels/main.tsx": PANEL, "panels/main.css": ".mini { color: red; }\n", ...files };
  for (const [name, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
}

const listDist = (dir: string) => fs.readdirSync(path.join(dir, "dist"), { recursive: true, encoding: "utf8" }).sort();
const readAll = (dir: string) => Object.fromEntries(listDist(dir).map((f) => [f, fs.readFileSync(path.join(dir, "dist", f))]));
const configTemps = () => fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("hh-plugin-config-"));

let root: string;
let cleanup: () => void;
let dir: string;
beforeEach(() => {
  ({ root, cleanup } = tempRoot("hh-plugin-build-"));
  dir = path.join(root, "mini");
  writePlugin(dir);
});
afterEach(() => cleanup());

describe("buildPlugin", () => {
  it("writes exactly plugin.json, backend.js and the panel's html, js and css", async () => {
    const r = await buildPlugin(dir);
    expect(listDist(dir)).toEqual(["backend.js", "panel-main.css", "panel-main.html", "panel-main.js", "plugin.json"]);
    expect(r.files).toEqual(listDist(dir));
    expect(r.dist).toBe(path.join(dir, "dist"));
    expect(r.manifest.id).toBe("mini");
  });

  it("writes a plugin.json the app's parser takes, zod turned into JSON Schema", async () => {
    await buildPlugin(dir);
    const text = fs.readFileSync(path.join(dir, "dist", "plugin.json"), "utf8");
    const m = parsePluginManifest(JSON.parse(text));
    expect(m.data.items.schema).toMatchObject({ type: "object", properties: { id: { type: "string" } } });
    expect(Object.keys(JSON.parse(text)).slice(0, 5)).toEqual(["id", "name", "version", "api", "harness"]);
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("writes a backend.js whose default export has the sources", async () => {
    await buildPlugin(dir);
    const mod = await import(pathToFileURL(path.join(dir, "dist", "backend.js")).href);
    expect(typeof mod.default.sources.items).toBe("function");
  });

  it("writes the panel page of Decision 6: a classic script after #root", async () => {
    await buildPlugin(dir);
    const html = fs.readFileSync(path.join(dir, "dist", "panel-main.html"), "utf8");
    expect(html).toBe(
      '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./panel-main.css"><div id="root"></div><script src="./panel-main.js"></script>\n',
    );
    expect(panelHtml("main")).toBe(html);
  });

  it("bundles React and plugin-ui as an IIFE with no process.env, and the panel's own CSS with plugin-ui's", async () => {
    await buildPlugin(dir);
    const js = fs.readFileSync(path.join(dir, "dist", "panel-main.js"), "utf8");
    expect(js.startsWith("(()=>{") || js.startsWith('"use strict";(()=>{')).toBe(true);
    expect(js).not.toMatch(/\bprocess\.env\b/);
    expect(js).not.toMatch(/^\s*(import|export)\b/m);
    expect(js).toContain("hhp-root");
    const css = fs.readFileSync(path.join(dir, "dist", "panel-main.css"), "utf8");
    expect(css).toContain(".mini");
    expect(css).toContain("--hh-");
  });

  it("is deterministic: two builds give byte-identical files", async () => {
    await buildPlugin(dir);
    const first = readAll(dir);
    await buildPlugin(dir);
    expect(readAll(dir)).toEqual(first);
  });

  it("keeps machine paths out of the output: no home folder, no plugin folder", async () => {
    await buildPlugin(dir);
    const needles = [os.homedir(), dir, fs.realpathSync(dir), root, fs.realpathSync(root)];
    for (const [name, bytes] of Object.entries(readAll(dir))) {
      const text = bytes.toString("utf8");
      for (const n of needles) expect(text.includes(n), `${name} holds ${n}`).toBe(false);
      expect(text, name).not.toMatch(/\/Users\/|\/home\/|\/private\/var\/|\/var\/folders\//);
    }
  });

  it("keeps machine paths out of CommonJS module keys: same output from two folders outside the repo", async () => {
    const cjs = {
      "src/helper.cjs": "module.exports = { twice: (n) => n * 2 };\n",
      "backend.ts": `import helper from "./src/helper.cjs";\nexport const twice = helper.twice;\n${BACKEND}`,
      "panels/main.tsx": `import helper from "../src/helper.cjs";\nexport const twice = helper.twice;\n${PANEL}`,
    };
    writePlugin(dir, cjs);
    const other = tempRoot("hh-plugin-build-other-");
    try {
      const dir2 = path.join(other.root, "deeper", "mini");
      writePlugin(dir2, cjs);
      await buildPlugin(dir);
      await buildPlugin(dir2);
      const out = readAll(dir);
      expect(out["backend.js"].toString("utf8")).toContain("__commonJS");
      expect(out["panel-main.js"].toString("utf8")).toContain("__commonJS");
      expect(readAll(dir2)).toEqual(out);
      const user = os.userInfo().username;
      const needles = [os.homedir(), os.tmpdir(), fs.realpathSync(os.tmpdir()), root, fs.realpathSync(root), ...(user.length >= 3 ? [user] : [])];
      for (const name of ["backend.js", "panel-main.js"]) {
        const text = out[name].toString("utf8");
        for (const n of needles) expect(text.includes(n), `${name} holds ${n}`).toBe(false);
        expect(text, name).not.toMatch(/\/Users\/|\/home\/|\/private\/|\/var\/folders\/|\.\.\/\.\.\//);
      }
    } finally {
      other.cleanup();
    }
  });

  it("builds a plugin folder with no node_modules (P-S9)", async () => {
    expect(fs.existsSync(path.join(dir, "node_modules"))).toBe(false);
    expect(fs.existsSync(path.join(root, "node_modules"))).toBe(false);
    await expect(buildPlugin(dir)).resolves.toBeTruthy();
  });

  it("writes dist/ fresh: a stale file is gone", async () => {
    fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
    fs.writeFileSync(path.join(dir, "dist", "plugin.json"), "{}");
    fs.writeFileSync(path.join(dir, "dist", "stale.js"), "old");
    await buildPlugin(dir);
    expect(fs.existsSync(path.join(dir, "dist", "stale.js"))).toBe(false);
  });

  it("removes its temporary config file, on success and on failure", async () => {
    // Other test files build too, sharing the temp folder: theirs come and go, a leaked one would stay.
    const settled = (before: string[]) => vi.waitFor(() => expect(configTemps().filter((f) => !before.includes(f))).toEqual([]), { timeout: 10_000 });
    const before = configTemps();
    await buildPlugin(dir);
    await settled(before);
    fs.writeFileSync(path.join(dir, "plugin.config.ts"), CONFIG.replace("z.string().max(200)", 'z.string().regex(/^a/)'));
    await expect(buildPlugin(dir)).rejects.toThrow();
    await settled(before);
  });

  it("fails on a zod regex with the allowlist message and leaves dist/ untouched", async () => {
    await buildPlugin(dir);
    const before = readAll(dir);
    fs.writeFileSync(path.join(dir, "plugin.config.ts"), CONFIG.replace("z.string().max(200)", 'z.string().regex(/^a/)'));
    const err = await buildPlugin(dir).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as Error).message).toContain('"pattern" is not supported in plugin schemas');
    expect(readAll(dir)).toEqual(before);
  });

  it("refuses a config whose default export is not a definePlugin result", async () => {
    fs.writeFileSync(path.join(dir, "plugin.config.ts"), "export default 42;\n");
    await expect(buildPlugin(dir)).rejects.toThrow(/plugin\.config\.ts.*definePlugin/);
  });

  it("reports a manifest the parser refuses as one line per problem", async () => {
    fs.writeFileSync(path.join(dir, "plugin.config.ts"), CONFIG.replace('agent: "read"', 'agent: "write"'));
    await expect(buildPlugin(dir)).rejects.toThrow(/^plugin\.config\.ts: data\.items\.agent: /);
  });

  it("names a missing backend.ts or panel file", async () => {
    fs.rmSync(path.join(dir, "panels", "main.tsx"));
    await expect(buildPlugin(dir)).rejects.toThrow("panels/main.tsx is missing");
    writePlugin(dir);
    fs.rmSync(path.join(dir, "backend.ts"));
    await expect(buildPlugin(dir)).rejects.toThrow("backend.ts is missing");
  });

  it("refuses top-level await in backend.ts and in a panel, leaving dist/ untouched", async () => {
    await buildPlugin(dir);
    const before = readAll(dir);
    fs.writeFileSync(path.join(dir, "backend.ts"), `await Promise.resolve();\n${BACKEND}`);
    await expect(buildPlugin(dir)).rejects.toThrow(/backend\.ts.*top-level await/);
    writePlugin(dir);
    fs.writeFileSync(path.join(dir, "panels", "main.tsx"), `await Promise.resolve();\n${PANEL}`);
    await expect(buildPlugin(dir)).rejects.toThrow(/panels\/main\.tsx.*top-level await/);
    expect(readAll(dir)).toEqual(before);
  });

  it("copies assets/ (.svg and .png only) and refuses anything else there", async () => {
    fs.mkdirSync(path.join(dir, "assets"));
    fs.writeFileSync(path.join(dir, "assets", "logo.svg"), "<svg/>");
    fs.writeFileSync(path.join(dir, "assets", "dot.png"), Buffer.from([137, 80, 78, 71]));
    await buildPlugin(dir);
    expect(listDist(dir)).toContain(path.join("assets", "logo.svg"));
    expect(fs.readFileSync(path.join(dir, "dist", "assets", "dot.png"))).toEqual(Buffer.from([137, 80, 78, 71]));
    fs.writeFileSync(path.join(dir, "assets", "run.js"), "alert(1)");
    await expect(buildPlugin(dir)).rejects.toThrow("assets/run.js: only .svg and .png files go in assets/");
    fs.rmSync(path.join(dir, "assets", "run.js"));
    fs.mkdirSync(path.join(dir, "assets", "sub"));
    await expect(buildPlugin(dir)).rejects.toThrow(/assets\/sub/);
    fs.rmSync(path.join(dir, "assets", "sub"), { recursive: true });
    fs.symlinkSync(path.join(dir, "backend.ts"), path.join(dir, "assets", "link.svg"));
    await expect(buildPlugin(dir)).rejects.toThrow(/assets\/link\.svg/);
  });

  it("refuses a symlinked assets/ folder and asset names the panel handler would not serve", async () => {
    const elsewhere = path.join(root, "pics");
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, "logo.svg"), "<svg/>");
    fs.symlinkSync(elsewhere, path.join(dir, "assets"));
    await expect(buildPlugin(dir)).rejects.toThrow(CliError);
    await expect(buildPlugin(dir)).rejects.toThrow(/assets\/.*link/);
    fs.rmSync(path.join(dir, "assets"));
    fs.mkdirSync(path.join(dir, "assets"));
    for (const bad of ["my logo.svg", "a.b.png", `${"x".repeat(65)}.svg`, "LOGO.SVG"]) {
      fs.writeFileSync(path.join(dir, "assets", bad), "<svg/>");
      await expect(buildPlugin(dir), bad).rejects.toThrow(CliError);
      fs.rmSync(path.join(dir, "assets", bad));
    }
    fs.writeFileSync(path.join(dir, "assets", "Ok_logo-2.svg"), "<svg/>");
    await expect(buildPlugin(dir)).resolves.toBeTruthy();
  });

  it("refuses an --out that is or holds the plugin folder, leaving the sources alone", async () => {
    fs.symlinkSync(dir, path.join(root, "alias"));
    for (const out of [dir, root, path.join(dir, "."), path.join(root, "alias"), path.dirname(root)]) {
      const err = await buildPlugin(dir, { out }).catch((e: unknown) => e);
      expect(err, out).toBeInstanceOf(CliError);
      expect((err as Error).message).toMatch(/--out/);
      expect(fs.readFileSync(path.join(dir, "backend.ts"), "utf8")).toBe(BACKEND);
    }
  });

  it("refuses a non-empty --out that is not a previous build", async () => {
    const out = path.join(root, "notes");
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, "todo.md"), "keep me");
    const err = await buildPlugin(dir, { out }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as Error).message).toMatch(/--out/);
    expect(fs.readFileSync(path.join(out, "todo.md"), "utf8")).toBe("keep me");
    fs.writeFileSync(path.join(root, "file.txt"), "a file");
    await expect(buildPlugin(dir, { out: path.join(root, "file.txt") })).rejects.toThrow(CliError);
    const empty = path.join(root, "empty");
    fs.mkdirSync(empty);
    await expect(buildPlugin(dir, { out: empty })).resolves.toBeTruthy();
  });

  it("leaves the previous dist/ whole when writing the new one fails, and no temp folder behind", async () => {
    await buildPlugin(dir);
    const before = readAll(dir);
    fs.writeFileSync(path.join(dir, "backend.ts"), `export const changed = 1;\n${BACKEND}`);
    const real = fs.promises.writeFile;
    const spy = vi.spyOn(fs.promises, "writeFile").mockImplementation(((file: fs.PathLike, ...rest: unknown[]) =>
      String(file).endsWith("panel-main.js") ? Promise.reject(new Error("disk full")) : (real as (...a: unknown[]) => Promise<void>)(file, ...rest)) as typeof real);
    try {
      await expect(buildPlugin(dir)).rejects.toThrow("disk full");
    } finally {
      spy.mockRestore();
    }
    expect(readAll(dir)).toEqual(before);
    expect(fs.readdirSync(dir).filter((f) => f.startsWith("dist") && f !== "dist")).toEqual([]);
  });

  it("writes to --out when given", async () => {
    const out = path.join(root, "elsewhere");
    const r = await buildPlugin(dir, { out });
    expect(r.dist).toBe(out);
    expect(fs.existsSync(path.join(out, "plugin.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "dist"))).toBe(false);
  });

  it("reports a bundling error as a CliError naming the plugin's file", async () => {
    fs.writeFileSync(path.join(dir, "panels", "main.tsx"), `import x from "./nope";\nexport default x;\n`);
    const err = await buildPlugin(dir).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as Error).message).toMatch(/^panels\/main\.tsx:1: /m);
  });
});
