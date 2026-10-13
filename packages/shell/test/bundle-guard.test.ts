import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bareDirnameRefs, noBareDirname } from "../src/build/bundle-guard";

const shim = [
  "// -- CommonJS Shims --",
  "import __cjs_mod__ from 'node:module';",
  "const __filename = import.meta.filename;",
  "const __dirname = import.meta.dirname;",
  "const require = __cjs_mod__.createRequire(import.meta.url);",
].join("\n");

describe("bundle guard (no bare __dirname in the built main process)", () => {
  it("lets the electron-vite shim, comments and properties through", () => {
    expect(bareDirnameRefs(shim)).toEqual([]);
    expect(bareDirnameRefs("/**\n * import x from 'y'\n" + shim.replace(/^/gm, " * ") + "\n */\nconst a = 1;")).toEqual([]);
    expect(bareDirnameRefs("// Not `__dirname`: see below\nconst here = import.meta.dirname;")).toEqual([]);
    expect(bareDirnameRefs("module.__dirname = 1; const __dirnameX = 2;")).toEqual([]);
  });

  it("finds a bare use, with its line", () => {
    expect(bareDirnameRefs(`${shim}\nconst file = path.join(__dirname, "../renderer/index.html");`)).toEqual([
      { line: 6, text: 'const file = path.join(__dirname, "../renderer/index.html");' },
    ]);
    expect(bareDirnameRefs("load(__filename)")).toHaveLength(1);
  });

  it("fails the build when a chunk uses one", () => {
    const plugin = noBareDirname();
    const errors: string[] = [];
    const ctx = { error: (m: string) => void errors.push(m) };
    const hook = plugin.generateBundle as unknown as (this: typeof ctx, o: unknown, b: Record<string, unknown>) => void;
    hook.call(ctx, {}, { "index.js": { type: "chunk", fileName: "index.js", code: shim }, "a.css": { type: "asset", fileName: "a.css", source: "" } });
    expect(errors).toEqual([]);
    hook.call(ctx, {}, { "index.js": { type: "chunk", fileName: "index.js", code: "x(__dirname)" } });
    expect(errors[0]).toContain("index.js:1");
  });

  // The shell's own main code uses import.meta.dirname (see src/main/index.ts): the shim once landed in a comment.
  it("the shell's main source has no bare __dirname or __filename", () => {
    const dir = path.join(import.meta.dirname, "../src/main");
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      expect(bareDirnameRefs(fs.readFileSync(path.join(dir, file), "utf8")), file).toEqual([]);
    }
  });
});
