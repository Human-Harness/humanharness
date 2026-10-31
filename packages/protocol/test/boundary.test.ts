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

  it("the shell's main, preload and tests do not import ui", () => {
    const list = [...imports(path.join(packages, "shell/src/main")), ...imports(path.join(packages, "shell/src/preload")), ...imports(path.join(packages, "shell/test"))];
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

// §3 / §8: who may import whom among the core packages (services: workspace, material, blocks, i18n).
// Packages not listed here (cli, e2e, fake-agent, and the services themselves) are not constrained.
const SERVICES = ["workspace", "material", "blocks", "i18n"];
const ALLOWED: Record<string, readonly string[] | "all-but-ui"> = {
  "harness-sdk": [],
  engines: ["harness-sdk"],
  policies: ["engines", "harness-sdk"],
  runtime: ["engines", "harness-sdk", ...SERVICES],
  protocol: ["harness-sdk", "engines", "workspace", "i18n"], // plan 2 deviation 1
  ui: ["protocol", "harness-sdk", "i18n"], // plan 2 deviation 3
  shell: "all-but-ui", // shell/src/renderer may import ui (plan 2 deviation 2)
};

/** Imports against the arrows that were there before this test (D2: not fixed here), each `file → spec` with why. */
const EXCEPTIONS: Readonly<Record<string, string>> = {
  "engines/src/contract.ts → @humanharness/blocks": "engines → blocks: the transport contract types MCP servers with blocks' McpServerSpec (type-only)",
  "engines/src/claude/transport.ts → @humanharness/blocks": "engines → blocks: the Claude transport passes MCP servers typed by blocks' McpServerSpec (type-only)",
};

/** The `@humanharness/<pkg>` a spec names (any subpath), or undefined for anything else. */
const target = (spec: string) => /^@humanharness\/([^/]+)/.exec(spec)?.[1];

/** The imports from `pkg`'s src that §3's arrows do not allow. Type-only imports count: the arrows are dependencies. */
function arrowViolations(pkg: string): string[] {
  const rule = ALLOWED[pkg];
  return offenders(imports(path.join(packages, pkg, "src")), (i) => {
    const to = target(i.spec);
    if (to === undefined || to === pkg) return false;
    if (rule === "all-but-ui") return to === "ui" && !i.file.startsWith(path.join(pkg, "src", "renderer") + path.sep);
    return !rule.includes(to);
  });
}

/** A file's text without block comments and `//` comment lines, as channels.test.ts reads it. */
const code = (file: string) => fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** `transport.kind`, or a `.kind` compared with a transport kind ("claude-cli", "acp") either way round. */
const TRANSPORT_KIND = /\btransport\??\.kind\b|\.kind\s*[!=]==?\s*["'](?:claude-cli|acp)["']|["'](?:claude-cli|acp)["']\s*[!=]==?\s*[\w$.?]*\.kind\b/;

describe("package arrows and policies' purity (replaceable parts §3, §8)", () => {
  for (const pkg of Object.keys(ALLOWED)) {
    it(`${pkg}/src imports only what §3 allows (named exceptions aside)`, () => {
      expect(arrowViolations(pkg).filter((v) => !(v in EXCEPTIONS))).toEqual([]);
    });
  }

  it("every named exception is still a real import (remove it once fixed)", () => {
    const all = new Set(Object.keys(ALLOWED).flatMap(arrowViolations));
    expect(Object.keys(EXCEPTIONS).filter((e) => !all.has(e))).toEqual([]);
  });

  it("policies/src imports no Node built-in, fs or child_process", () => {
    const io = /^(node:|fs$|fs\/|child_process$)/;
    expect(offenders(imports(path.join(packages, "policies/src")), (i) => io.test(i.spec))).toEqual([]);
  });

  it("policies/src imports engines only through its root (./registry re-exports the transports)", () => {
    expect(offenders(imports(path.join(packages, "policies/src")), (i) => /^@humanharness\/engines\//.test(i.spec))).toEqual([]);
  });

  it("no file outside engines/src reads transport.kind or compares a kind with a transport kind", () => {
    const files = fs
      .readdirSync(packages, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "engines" && d.name !== "node_modules" && fs.existsSync(path.join(packages, d.name, "src")))
      .flatMap((d) => sources(path.join(packages, d.name, "src")));
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => TRANSPORT_KIND.test(code(f))).map((f) => path.relative(packages, f))).toEqual([]);
  });
});
