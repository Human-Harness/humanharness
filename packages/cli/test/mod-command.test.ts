import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findHome } from "../src/app-home";
import { CliError } from "../src/cli";
import { main } from "../src/main";
import { memoryIo, read, tempRoot } from "./helpers";

let root: string;
let cleanup: () => void;
let home: string;
beforeEach(() => {
  ({ root, cleanup } = tempRoot("hh-mod-cmd-"));
  home = path.join(root, "app");
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, ".layers.json"), "{}\n");
});
afterEach(() => cleanup());

/** Writes files under `dir`, creating folders. */
function write(dir: string, files: Record<string, string>): void {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
}
const json = (o: unknown) => `${JSON.stringify(o, null, 2)}\n`;
const modJson = (o: Record<string, unknown> = {}) => json({ id: "hello", name: "Hello", version: "0.1.0", apiVersion: 1, ...o });

const GOOD_MAIN = `import { defineMod } from "@humanharness/mod-sdk";
import { z } from "zod";
export default defineMod({
  id: "hello",
  schema: z.object({ greeting: z.string().default("hi") }),
  main(ctx) {
    ctx.on.beforeSend(() => ({ ok: true }));
    ctx.ipc("ping", () => "pong");
  },
});
`;
const GOOD_UI = `import { defineMod } from "@humanharness/mod-sdk";
import { Rx, useApp } from "@humanharness/ui";
function Hello({ props }: { props: Record<string, unknown> }) {
  const app = useApp();
  return <Rx.Text>Hello {String(props.name ?? "")} {String(app.task?.title ?? "")}</Rx.Text>;
}
export default defineMod({
  id: "hello",
  ui(ctx) {
    ctx.block("hello", Hello);
  },
});
`;

async function run(argv: string[], cwd = home) {
  const m = memoryIo(cwd);
  const code = await main(argv, m.io);
  return { code, out: m.out(), err: m.err() };
}

describe("findHome", () => {
  it("takes --home, else walks up to the folder with .layers.json", () => {
    fs.mkdirSync(path.join(home, "mods", "x"), { recursive: true });
    expect(findHome(path.join(home, "mods", "x"), undefined)).toBe(home);
    expect(findHome(root, home)).toBe(home);
  });

  it("refuses a folder outside any home", () => {
    expect(() => findHome(root, undefined)).toThrow(CliError);
    expect(() => findHome(root, undefined)).toThrow("Run this inside the app's home folder, or pass --home <dir>");
  });
});

describe("mod check", { timeout: 120_000 }, () => {
  it("passes a good mod: mod.json, both bundles, main against a fake ctx and each block rendered", async () => {
    const dir = path.join(home, "mods", "hello");
    write(dir, { "mod.json": modJson({ main: "main.ts", ui: "ui.tsx" }), "main.ts": GOOD_MAIN, "ui.tsx": GOOD_UI });
    const r = await run(["mod", "check", "mods/hello"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toContain("✓ mod.json");
    expect(r.out).toContain("✓ main: bundled");
    expect(r.out).toContain("✓ main: ran (beforeSend, ipc ping)");
    expect(r.out).toContain("✓ ui: bundled");
    expect(r.out).toContain("✓ block hello: rendered");
    expect(r.out).not.toContain("✗");
  }, 120_000);

  it("fails a mod.json that doesn't parse or doesn't validate", async () => {
    const dir = path.join(home, "mods", "bad");
    write(dir, { "mod.json": json({ id: "Bad Id", name: "x", version: "1", apiVersion: 1 }) });
    const r = await run(["mod", "check", dir]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/✗ mod\.json: /);
    write(dir, { "mod.json": "{ nope" });
    expect((await run(["mod", "check", dir])).out).toMatch(/✗ mod\.json: /);
  });

  it("fails a mod whose main throws", async () => {
    const dir = path.join(home, "mods", "hello");
    write(dir, { "mod.json": modJson({ main: "main.ts" }), "main.ts": `import { defineMod } from "@humanharness/mod-sdk";\nexport default defineMod({ id: "hello", main() { throw new Error("boom in main"); } });\n` });
    const r = await run(["mod", "check", dir]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("✓ main: bundled");
    expect(r.out).toContain("✗ main: boom in main");
  }, 120_000);

  it("fails a mod whose block throws", async () => {
    const dir = path.join(home, "mods", "hello");
    const ui = `import { defineMod } from "@humanharness/mod-sdk";\nfunction Bad(): never { throw new Error("boom in block"); }\nexport default defineMod({ id: "hello", ui(ctx) { ctx.block("bad", Bad); } });\n`;
    write(dir, { "mod.json": modJson({ ui: "ui.tsx" }), "ui.tsx": ui });
    const r = await run(["mod", "check", dir]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("✗ block bad: boom in block");
  }, 120_000);

  it("fails a bundle that imports what a mod may not, and an id that doesn't match mod.json", async () => {
    const dir = path.join(home, "mods", "hello");
    write(dir, { "mod.json": modJson({ main: "main.ts", ui: "ui.tsx" }), "main.ts": `import fs from "node:fs";\nexport default { id: "hello", main() { fs; } };\n`, "ui.tsx": GOOD_UI.replaceAll('id: "hello"', 'id: "other"') });
    const r = await run(["mod", "check", dir]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/✗ main: .*node:fs can't be imported/);
    expect(r.out).toContain('✗ ui: defineMod has id "other", mod.json has "hello"');
  }, 120_000);

  it("needs a folder", async () => {
    expect((await run(["mod", "check"])).code).toBe(2);
    const r = await run(["mod", "check", "nowhere"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/✗ mod\.json: /);
  });
});

describe("mod clone", () => {
  beforeEach(() => {
    write(path.join(home, "core", "mods", "home"), {
      "mod.json": json({ id: "home", name: "Home", version: "0.1.0", apiVersion: 1, ui: "ui.js" }),
      "README.md": "# Home\n",
      "src/ui.tsx": `import { defineMod } from "@humanharness/mod-sdk";\nexport default defineMod({ id: "home", ui(ctx) {} });\n`,
    });
    write(path.join(home, "harness", "mods", "notes"), {
      "mod.json": json({ id: "notes", name: "Notes", version: "1.2.3", apiVersion: 1, main: "main.mjs" }),
      "src/main.ts": `import { defineMod } from "@humanharness/mod-sdk";\nexport default defineMod({\n  id: 'notes',\n  main() {},\n});\n`,
    });
  });

  it("copies a core mod to mods/<as> with its source entries, the new id and clonedFrom", async () => {
    const r = await run(["mod", "clone", "home", "my-home"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    const dir = path.join(home, "mods", "my-home");
    expect(r.out).toContain(dir);
    expect(JSON.parse(read(dir, "mod.json"))).toEqual({ id: "my-home", name: "Home", version: "0.1.0", apiVersion: 1, ui: "src/ui.tsx", clonedFrom: { id: "home", version: "0.1.0" } });
    expect(read(dir, "src/ui.tsx")).toContain('defineMod({ id: "my-home"');
    expect(read(dir, "README.md")).toBe("# Home\n");
  });

  it("copies a harness mod under its own id by default", async () => {
    const r = await run(["mod", "clone", "notes", "--home", home], root);
    expect(r.code).toBe(0);
    const dir = path.join(home, "mods", "notes");
    expect(JSON.parse(read(dir, "mod.json"))).toMatchObject({ id: "notes", main: "src/main.ts", clonedFrom: { id: "notes", version: "1.2.3" } });
    expect(read(dir, "src/main.ts")).toContain("id: 'notes'");
  });

  it("refuses an existing target, an unknown mod and a bad id", async () => {
    fs.mkdirSync(path.join(home, "mods", "home"), { recursive: true });
    const exists = await run(["mod", "clone", "home"]);
    expect(exists.code).toBe(1);
    expect(exists.err).toContain("already exists");
    const unknown = await run(["mod", "clone", "nope", "x"]);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain("No mod nope in core/mods or harness/mods");
    const bad = await run(["mod", "clone", "home", "Bad Id"]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("isn't a valid mod id");
    expect((await run(["mod", "clone"])).code).toBe(2);
  });

  it("refuses outside a home folder", async () => {
    const r = await run(["mod", "clone", "home"], root);
    expect(r.code).toBe(1);
    expect(r.err).toContain("--home <dir>");
  });
});

describe("layout clone", () => {
  beforeEach(() => {
    write(home, { "core/layouts/main.json": json({ from: "core" }), "harness/layouts/main.json": json({ from: "harness" }), "harness/layouts/wide.json": json({ from: "wide" }) });
  });

  it("copies the harness's layout first, else the core's, to layouts/<as>.json", async () => {
    const r = await run(["layout", "clone", "main", "mine"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(read(home, "layouts/mine.json"))).toEqual({ from: "harness" });
    fs.rmSync(path.join(home, "harness"), { recursive: true });
    expect((await run(["layout", "clone", "main"])).code).toBe(0);
    expect(JSON.parse(read(home, "layouts/main.json"))).toEqual({ from: "core" });
  });

  it("refuses an existing target, an unknown layout and a bad name", async () => {
    write(home, { "layouts/wide.json": "{}" });
    const exists = await run(["layout", "clone", "wide"]);
    expect(exists.code).toBe(1);
    expect(exists.err).toContain("already exists");
    expect(read(home, "layouts/wide.json")).toBe("{}");
    const unknown = await run(["layout", "clone", "nope"]);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain("No layout nope in harness/layouts or core/layouts");
    expect((await run(["layout", "clone", "main", "../out"])).err).toContain("isn't a valid layout name");
    expect((await run(["layout", "clone"])).code).toBe(2);
  });
});
