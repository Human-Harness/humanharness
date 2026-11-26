import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tableKeys } from "./contract-docs";

const packages = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === "node_modules" ? [] : sources(p);
    return /\.tsx?$/.test(d.name) ? [p] : [];
  });
}

/** A file's text without block comments and `//` comment lines, so a channel only mentioned in a comment doesn't count. */
const code = (file: string) => fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every "hh:…" string literal in a folder's code. */
function literals(dir: string, keep: (file: string) => boolean = () => true): Set<string> {
  const found = new Set<string>();
  for (const file of sources(dir).filter(keep)) for (const m of code(file).matchAll(/"(hh:[A-Za-z]+)"/g)) found.add(m[1]);
  return found;
}

const invoke = tableKeys("Invoke", path.resolve(packages, ".."));
const push = tableKeys("Push", path.resolve(packages, ".."));
const table = new Set([...invoke, ...push]);
/** A core mod's main side: its `src` code, without renderer and UI files (`.tsx`, `ui*`, `renderer*`). */
const modMain = (file: string) => !/\.tsx$/.test(file) && !/^(ui|renderer)/.test(path.basename(file));
const modsDir = path.join(packages, "mods");
const main = new Set([
  ...literals(path.join(packages, "shell/src/main")),
  ...fs
    .readdirSync(modsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(modsDir, d.name, "src")))
    .flatMap((d) => [...literals(path.join(modsDir, d.name, "src"), modMain)]),
]);
const preload = literals(path.join(packages, "shell/src/preload"));

describe("IPC channel table (replaceable parts §5.3)", () => {
  it("reads both maps", () => {
    expect(invoke.size).toBeGreaterThan(100);
    expect(push.size).toBeGreaterThan(10);
    // hh:scopes is both: the scope list asks it (scopes.list) and main pushes it when the list changes.
    expect([...invoke].filter((c) => push.has(c))).toEqual(["hh:scopes"]);
  });

  it("has a handler or a sender in main for every channel", () => {
    expect([...table].filter((c) => !main.has(c))).toEqual([]);
  });

  it("is used by the preload for every channel", () => {
    expect([...table].filter((c) => !preload.has(c))).toEqual([]);
  });

  it("holds every channel main and the preload name", () => {
    expect([...main, ...preload].filter((c) => !table.has(c))).toEqual([]);
  });
});

describe("Sidekick's names (minimal-core 1b)", () => {
  /** The core's side of the window/main contract: the protocol, the preload and the window's client. */
  const core = [...sources(path.join(packages, "protocol/src")), ...sources(path.join(packages, "shell/src/preload")), path.join(packages, "ui/src/client.ts")];

  /** The old prefix, built from pieces so `git grep` for it finds nothing in the repo. */
  const OLD = `hh:${"sidekick"}`;

  it("are no channel of the core's: the mod's calls and its state go on its own names (mods.sidekick.*)", () => {
    expect([...table].filter((c) => c.startsWith(OLD))).toEqual([]);
    expect([...main, ...preload].filter((c) => c.startsWith(OLD))).toEqual([]);
  });

  it("are declared in no file of the protocol, the preload or the client", () => {
    const declared = new RegExp(`"${OLD}[A-Za-z]*"|\\bSidekick[A-Z][A-Za-z]*\\b|^\\s+sidekick\\s*:\\s*\\{`, "gm");
    const offenders = core.flatMap((file) => {
      const text = code(file);
      const found = [...text.matchAll(declared)].map((m) => m[0].trim());
      return found.map((name) => `${path.relative(packages, file)}: ${name}`);
    });
    expect(offenders).toEqual([]);
  });
});
