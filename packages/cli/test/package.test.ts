import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { checkHarness } from "../src/check";
import { initHarness } from "../src/init";
import { main } from "../src/main";
import { type PackageDeps, packageCommand } from "../src/package";
import { packageConfig } from "../src/package-config";
import { CORE, memoryIo, memoryStream, tempRoot } from "./helpers";

// Not about mods: the template's untouched sample mod passes without a real build (stub-mod-check.ts).
vi.mock("../src/kit/check", async (real) => (await import("./stub-mod-check")).withStub(await real<typeof import("../src/kit/check")>()));

// Not about the build: the tools build once per distinct set of tool sources, not once per test (cached-tool-build.ts).
vi.mock("../src/tool-build", async (real) => (await import("./cached-tool-build")).withCache(await real<typeof import("../src/tool-build")>()));

const { root, cleanup } = tempRoot("hh-package-");
afterAll(cleanup);
let n = 0;
async function harness() {
  const dir = path.join(root, `h${++n}`);
  await initHarness({ dir, core: CORE, install: false });
  return dir;
}

const SIGNED = { CSC_LINK: "cert.p12", APPLE_API_KEY: "key.p8", APPLE_API_KEY_ID: "KEY", APPLE_API_ISSUER: "issuer" };
const ARTIFACTS = path.join(root, "artifacts");

/** Fake shell build and electron-builder: they record their calls. */
function fakes(shellCode = 0) {
  const shell: { harnessDir: string; outDir: string }[] = [];
  const builds: Parameters<PackageDeps["build"]>[0][] = [];
  const deps: PackageDeps = {
    buildShell: async (o) => {
      shell[shell.length] = o;
      return shellCode;
    },
    build: async (o) => {
      builds[builds.length] = o;
      return ["/out/Demo-0.1.0-universal.dmg", "/out/Demo-0.1.0-universal-mac.zip"];
    },
  };
  return { deps, shell, builds };
}

function run(dir: string, o: { publish?: boolean; env?: NodeJS.ProcessEnv; feed?: string; deps: PackageDeps }) {
  const out = memoryStream();
  const result = packageCommand({ harnessDir: dir, outDir: ARTIFACTS, publish: o.publish, feed: o.feed, env: o.env ?? {}, out: out.stream, deps: o.deps });
  return { result, text: out.text };
}

describe("packageCommand", () => {
  it("a failing manifest check stops before building", async () => {
    const dir = await harness();
    fs.rmSync(path.join(dir, "HARNESS.md"));
    const f = fakes();
    const r = run(dir, { deps: f.deps });
    expect(await r.result).toBe(1);
    expect(r.text()).toContain("HARNESS.md is missing");
    expect(f.shell).toEqual([]);
    expect(f.builds).toEqual([]);
  });

  it("--publish without CSC_LINK refuses before building", async () => {
    const dir = await harness();
    const f = fakes();
    const r = run(dir, { publish: true, deps: f.deps });
    expect(await r.result).toBe(1);
    expect(r.text()).toContain("publishing needs a signed build: set CSC_LINK, ");
    expect(f.shell).toEqual([]);
    expect(f.builds).toEqual([]);
  });

  it("--publish with CSC_LINK but no Apple API key refuses the same way", async () => {
    const dir = await harness();
    const f = fakes();
    const r = run(dir, { publish: true, env: { CSC_LINK: "cert.p12" }, deps: f.deps });
    expect(await r.result).toBe(1);
    expect(r.text()).toContain("publishing needs a signed build: set CSC_LINK, ");
    expect(f.builds).toEqual([]);
  });

  it("without signing variables it warns once and builds unsigned", async () => {
    const dir = await harness();
    const f = fakes();
    const r = run(dir, { deps: f.deps });
    expect(await r.result).toBe(0);
    expect(r.text().match(/unsigned/g)).toHaveLength(1);
    expect(f.builds).toHaveLength(1);
    expect(f.builds[0].config.mac?.identity).toBeNull();
    expect(f.builds[0].config.mac?.notarize).toBe(false);
  });

  it("builds the shell with the harness into a temp folder, then passes packageConfig's config to the builder", async () => {
    const dir = await harness();
    const { harness: manifest } = await checkHarness(dir);
    const f = fakes();
    const r = run(dir, { env: SIGNED, feed: "http://localhost:9000", deps: f.deps });
    expect(await r.result).toBe(0);
    expect(f.shell).toHaveLength(1);
    expect(f.shell[0].harnessDir).toBe(dir);
    const version = JSON.parse(fs.readFileSync(path.join(CORE, "package.json"), "utf8")).version;
    expect(f.builds[0].config).toEqual(
      packageConfig({
        harness: { id: manifest!.id, name: manifest!.name },
        version,
        platform: "mac",
        feed: "http://localhost:9000",
        signing: true,
        harnessDir: dir,
        appDir: path.join(CORE, "packages", "shell"),
        buildDir: f.shell[0].outDir,
        outDir: ARTIFACTS,
      }),
    );
    expect(r.text()).toContain("/out/Demo-0.1.0-universal.dmg");
    expect(r.text()).not.toContain("unsigned");
  });

  it("--publish maps to publish: always, else never", async () => {
    const dir = await harness();
    const f = fakes();
    expect(await run(dir, { publish: true, env: SIGNED, deps: f.deps }).result).toBe(0);
    expect(await run(dir, { env: SIGNED, deps: f.deps }).result).toBe(0);
    expect(f.builds.map((b) => b.publish)).toEqual(["always", "never"]);
  });

  it("a failing shell build stops before packaging", async () => {
    const dir = await harness();
    const f = fakes(1);
    expect(await run(dir, { deps: f.deps }).result).toBe(1);
    expect(f.builds).toEqual([]);
  });
});

describe("humanharness package", () => {
  it("is listed in the usage", async () => {
    const io = memoryIo(root);
    expect(await main(["--help"], io.io)).toBe(0);
    expect(io.out()).toContain("package [--harness <dir>] [--publish] [--feed <url>] [--out <dir>]");
  });

  it("refuses an --out inside the harness folder (it would be packaged into the app)", async () => {
    const dir = await harness();
    const io = memoryIo(dir);
    expect(await main(["package", "--out", "dist/app"], io.io)).toBe(2);
    expect(io.err()).toContain("--out must be outside the harness folder");
  });
});
