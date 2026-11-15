import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_FEED, packageConfig } from "../src/package-config";

const harnessDir = "/repo/harnesses/teacher";
const appDir = "/repo/packages/shell";
const base = {
  harness: { id: "teacher", name: "Teacher" },
  version: "0.3.0",
  platform: "mac" as const,
  signing: true,
  harnessDir,
  appDir,
  buildDir: "/tmp/hh-build",
  outDir: "/tmp/hh-out",
};

describe("packageConfig (release spec §3.1)", () => {
  it("appId is org.humanharness.<id> and productName is the manifest name", () => {
    const c = packageConfig(base);
    expect(c.appId).toBe("org.humanharness.teacher");
    expect(c.productName).toBe("Teacher");
  });

  it("buildVersion and the app's version come from version", () => {
    const c = packageConfig(base);
    expect(c.buildVersion).toBe("0.3.0");
    expect(c.extraMetadata).toMatchObject({ version: "0.3.0" });
  });

  it("the icon is the manifest logo resolved against the harness folder", () => {
    expect(packageConfig({ ...base, harness: { ...base.harness, logo: "./ui/logo.png" } }).mac?.icon).toBe(path.join(harnessDir, "ui/logo.png"));
  });

  it("without a logo the icon is the shell's hh-logo.png", () => {
    expect(packageConfig(base).mac?.icon).toBe(path.join(appDir, "resources", "hh-logo.png"));
  });

  it("mac targets dmg and zip, universal", () => {
    expect(packageConfig(base).mac?.target).toEqual([
      { target: "dmg", arch: ["universal"] },
      { target: "zip", arch: ["universal"] },
    ]);
  });

  it("mac uses the hardened runtime and the shell's entitlements files", () => {
    const mac = packageConfig(base).mac;
    expect(mac?.hardenedRuntime).toBe(true);
    expect(mac?.entitlements).toBe(path.join(appDir, "build", "entitlements.mac.plist"));
    expect(mac?.entitlementsInherit).toBe(path.join(appDir, "build", "entitlements.mac.inherit.plist"));
  });

  it("with signing: notarize is true and no identity is forced", () => {
    const mac = packageConfig(base).mac;
    expect(mac?.notarize).toBe(true);
    expect(mac).not.toHaveProperty("identity");
  });

  it("without signing: notarize is false and identity is null (no signing attempt)", () => {
    const mac = packageConfig({ ...base, signing: false }).mac;
    expect(mac?.notarize).toBe(false);
    expect(mac?.identity).toBeNull();
  });

  it("extraResources: the harness folder to harness (no node_modules, test, mock), the shell resources to the resources root", () => {
    expect(packageConfig(base).extraResources).toEqual([
      { from: harnessDir, to: "harness", filter: ["**/*", "!node_modules{,/**}", "!test{,/**}", "!mock{,/**}"] },
      { from: path.join(appDir, "resources"), to: ".", filter: ["**/*"] },
    ]);
  });

  it("publish: generic provider on the GitHub latest-release feed, channel <id>", () => {
    expect(packageConfig(base).publish).toEqual({ provider: "generic", url: DEFAULT_FEED, channel: "teacher" });
    expect(DEFAULT_FEED).toBe("https://github.com/Human-Harness/humanharness/releases/latest/download");
  });

  it("publish: --feed replaces the feed URL", () => {
    expect(packageConfig({ ...base, feed: "http://localhost:8080" }).publish).toEqual({ provider: "generic", url: "http://localhost:8080", channel: "teacher" });
  });

  it("has no win section (stage 2)", () => {
    expect(packageConfig(base)).not.toHaveProperty("win");
  });

  it("artifact names: <productName>-<version>-universal.dmg and -universal-mac.zip (spec §4)", () => {
    const c = packageConfig(base);
    expect(c.dmg?.artifactName).toBe("${productName}-${version}-universal.${ext}");
    expect(c.mac?.artifactName).toBe("${productName}-${version}-universal-mac.${ext}");
  });

  it("packages the shell's built output as out/, the shell package's main, into --out", () => {
    const c = packageConfig(base);
    expect(c.directories).toEqual({ app: appDir, output: "/tmp/hh-out" });
    expect(c.files).toEqual(["package.json", { from: "/tmp/hh-build", to: "out", filter: ["**/*"] }]);
  });
});
