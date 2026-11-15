import path from "node:path";
import type { Configuration } from "electron-builder";

/** Where installed apps look for updates: the latest GitHub release of the core repo (release spec §3.1). */
export const DEFAULT_FEED = "https://github.com/Human-Harness/humanharness/releases/latest/download";

/** Per-arch native packages (and the already universal fsevents) that the universal app keeps as they are. */
export const X64_ARCH_FILES = "Contents/Resources/app.asar.unpacked/node_modules/{@esbuild/darwin-*,@napi-rs/canvas-darwin-*,@openai/codex-darwin-*,esbuild/bin,fsevents}/**";

export interface PackageConfigInput {
  /** The manifest fields the app is named and branded by. */
  harness: { id: string; name: string; logo?: string };
  /** The root package.json version (lockstep, D4). */
  version: string;
  /** macOS only in stage 1. */
  platform: "mac";
  /** The update feed URL; default DEFAULT_FEED. */
  feed?: string;
  /** Signing variables present: sign and notarize. Without them, no signing attempt at all. */
  signing: boolean;
  /** The harness folder (absolute). */
  harnessDir: string;
  /** packages/shell (absolute): its package.json and production dependencies make the app. */
  appDir: string;
  /** The shell's electron-vite build (HH_OUT_DIR), packaged as the app's out/. */
  buildDir: string;
  /** Where the artifacts go. */
  outDir: string;
}

/** The electron-builder config for one harness's app (release spec §3.1, §4). Pure: no electron-builder at runtime. */
export function packageConfig(o: PackageConfigInput): Configuration {
  const shellResources = path.join(o.appDir, "resources");
  const icon = o.harness.logo ? path.resolve(o.harnessDir, o.harness.logo) : path.join(shellResources, "hh-logo.png");
  return {
    appId: `org.humanharness.${o.harness.id}`,
    productName: o.harness.name,
    buildVersion: o.version,
    extraMetadata: { version: o.version },
    directories: { app: o.appDir, output: o.outDir },
    // The shell's package.json says main is out/main/index.js.
    files: ["package.json", { from: o.buildDir, to: "out", filter: ["**/*"] }],
    extraResources: [
      // A packaged app reads its harness from <resources>/harness (shell-resources.ts harnessDirFor).
      { from: o.harnessDir, to: "harness", filter: ["**/*", "!node_modules{,/**}", "!test{,/**}", "!mock{,/**}"] },
      // ...and the hosts' files and Dock icon from <resources> itself (shellResourcesDir).
      { from: shellResources, to: ".", filter: ["**/*"] },
    ],
    mac: {
      target: [
        { target: "dmg", arch: ["universal"] },
        { target: "zip", arch: ["universal"] },
      ],
      icon,
      artifactName: "${productName}-${version}-universal-mac.${ext}",
      // Prebuilt binaries installed for both arches (pnpm supportedArchitectures) are the same file in both builds.
      x64ArchFiles: X64_ARCH_FILES,
      hardenedRuntime: true,
      entitlements: path.join(o.appDir, "build", "entitlements.mac.plist"),
      entitlementsInherit: path.join(o.appDir, "build", "entitlements.mac.inherit.plist"),
      notarize: o.signing,
      ...(o.signing ? {} : { identity: null }),
    },
    dmg: { artifactName: "${productName}-${version}-universal.${ext}" },
    // Several apps share one release: each reads <id>-mac.yml.
    publish: { provider: "generic", url: o.feed ?? DEFAULT_FEED, channel: o.harness.id },
  };
}
