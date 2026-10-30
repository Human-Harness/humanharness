import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packages = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === "node_modules" ? [] : sources(p);
    return /\.tsx?$/.test(d.name) ? [p] : [];
  });
}

interface Import {
  file: string;
  spec: string;
  typeOnly: boolean;
}

/** Every static import and re-export with a `from` (multi-line ones included), plus side-effect, dynamic and `require` imports. */
function imports(dir: string): Import[] {
  return sources(dir).flatMap((file) => {
    const text = fs.readFileSync(file, "utf8");
    const rel = path.relative(packages, file);
    const statics = [...text.matchAll(/^(import|export)\s+(type\s+)?[^;]*?\sfrom\s+"([^"]+)"/gms)].map((m) => ({ file: rel, spec: m[3], typeOnly: m[2] !== undefined }));
    const others = [...text.matchAll(/^import\s+"([^"]+)"|\b(?:import|require)\(\s*"([^"]+)"\s*\)/gm)].map((m) => ({ file: rel, spec: m[1] ?? m[2], typeOnly: false }));
    return [...statics, ...others];
  });
}

const offenders = (list: Import[], bad: (i: Import) => boolean) => list.filter(bad).map((i) => `${i.file} → ${i.spec}`);

describe("import boundaries (replaceable parts §5.5, §8)", () => {
  it("ui/src imports no core package", () => {
    const core = /^@humanharness\/(runtime|engines|workspace|material|blocks|shell)(\/|$)/;
    expect(offenders(imports(path.join(packages, "ui/src")), (i) => core.test(i.spec))).toEqual([]);
  });

  it("the shell's main and preload do not import ui", () => {
    const list = [...imports(path.join(packages, "shell/src/main")), ...imports(path.join(packages, "shell/src/preload"))];
    expect(offenders(list, (i) => /^@humanharness\/ui(\/|$)/.test(i.spec))).toEqual([]);
  });

  it("protocol imports harness-sdk, and only types from engines, workspace and i18n (plus the history subjects)", () => {
    const allowed = (i: Import) =>
      !i.spec.startsWith("@humanharness/") ||
      /^@humanharness\/harness-sdk(\/|$)/.test(i.spec) ||
      i.spec === "@humanharness/workspace/subjects" ||
      (i.typeOnly && /^@humanharness\/(engines|workspace|i18n)$/.test(i.spec));
    expect(offenders(imports(path.join(packages, "protocol/src")), (i) => !allowed(i))).toEqual([]);
  });

  it("protocol is renderer-safe: no Node, Electron or React", () => {
    expect(offenders(imports(path.join(packages, "protocol/src")), (i) => /^(node:|electron$|react)/.test(i.spec))).toEqual([]);
  });
});
