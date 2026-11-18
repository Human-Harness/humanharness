import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

// actionlint is not installed here: these checks parse the YAML and pin the parts the release spec fixes (§3.4, §4).
// js-yaml is only a transitive dependency (electron-builder's), so it is resolved from there.
const root = path.resolve(__dirname, "..");
const req = createRequire(fs.realpathSync(path.join(root, "packages/cli/node_modules/electron-builder/package.json")));
const yaml = req("js-yaml") as { load(text: string): any };
const load = (name: string) => yaml.load(fs.readFileSync(path.join(root, ".github/workflows", name), "utf8"));

describe("ci.yml", () => {
  const ci = load("ci.yml");
  const runs = (job: string) => ci.jobs[job].steps.map((s: any) => s.run).filter(Boolean);
  it("runs on pull requests to master, on macOS, one run per PR", () => {
    expect(ci.on.pull_request.branches).toEqual(["master"]);
    for (const j of ["typecheck", "test", "package"]) expect(ci.jobs[j]["runs-on"]).toBe("macos-latest");
    expect(ci.concurrency.group).toContain("github.event.pull_request.number");
  });
  it("caps every job at 25 minutes, so a hung step fails fast instead of holding the run for hours", () => {
    for (const j of ["typecheck", "test", "package"]) expect(ci.jobs[j]["timeout-minutes"]).toBe(25);
  });
  it("runs typecheck, unit tests and an unsigned package (no e2e: those run locally), in parallel jobs", () => {
    expect(Object.keys(ci.jobs).sort()).toEqual(["package", "test", "typecheck"]);
    expect(runs("typecheck")).toEqual(["corepack enable", "pnpm install --frozen-lockfile", "pnpm typecheck"]);
    expect(runs("test")).toEqual(["corepack enable", "pnpm install --frozen-lockfile", "pnpm test"]);
    expect(runs("package")).toEqual([
      "corepack enable",
      "pnpm install --frozen-lockfile",
      "pnpm humanharness package --harness harnesses/demo --out dist-ci",
    ]);
  });
});

describe("release.yml", () => {
  const rel = load("release.yml");
  it("runs on v* tags with contents: write only", () => {
    expect(rel.on.push.tags).toEqual(["v*"]);
    expect(rel.permissions).toEqual({ contents: "write" });
  });
  it("has prepare, build and publish in the release environment, in order", () => {
    for (const j of ["prepare", "build", "publish"]) expect(rel.jobs[j].environment).toBe("release");
    expect(rel.jobs.build.needs).toBe("prepare");
    expect(rel.jobs.publish.needs).toBe("build");
    expect(rel.jobs.prepare["runs-on"]).toBe("ubuntu-latest");
    expect(rel.jobs.build["runs-on"]).toBe("macos-latest");
    expect(rel.jobs.publish["runs-on"]).toBe("ubuntu-latest");
  });
  it("builds one job per harness id and passes the signing secrets", () => {
    expect(rel.jobs.build.strategy.matrix.harness).toContain("needs.prepare.outputs.harnesses");
    const env = rel.jobs.build.steps.find((s: any) => s.run?.includes("--publish")).env;
    for (const k of ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_API_KEY_ID", "APPLE_API_ISSUER", "GH_TOKEN"]) expect(env).toHaveProperty(k);
    const key = rel.jobs.build.steps.find((s: any) => s.run?.includes("AuthKey.p8"));
    expect(key.run).toContain("APPLE_API_KEY=");
  });
  it("creates a draft in prepare and publishes it last", () => {
    const text = (j: string) => JSON.stringify(rel.jobs[j].steps);
    expect(text("prepare")).toContain("release create");
    expect(text("prepare")).toContain("--draft");
    expect(text("publish")).toContain("--draft=false");
  });
});
