# Release and updates — design

Date: 2026-11-15
Status: approved by Marco section by section on 2026-11-15; written spec under review
Source: roadmap plan 4b ("Release") and the core spec (`2026-10-10-humanharness-core-design.md`, §4, §9 "Updates", §11 "Releases", §12 "Windows and Linux"). This spec replaces plan 4b and brings Windows into v1.

## 1. Goal

Marco tags one version and every official harness ships, signed, to macOS and Windows users. Installed apps update themselves.

- The shell builds with `electron-vite build` only. Nothing packages, signs or publishes an app today.
- A fix in the core must reach every harness without one manual release per harness.
- The simplest working path wins: standard tools, no update server of our own.

**Decisions taken while shaping (2026-11-15):**

| # | Decision | Rejected |
|---|---|---|
| D1 | electron-builder + electron-updater, feed on GitHub Releases | Electron Forge + update.electronjs.org (ties Windows to Squirrel.Windows, one public repo per app) |
| D2 | One core tag rebuilds and publishes every official harness (fan-out in CI) | One shared runtime app with harnesses as content packages (breaks "one app per harness" and "Marco signs only his own harnesses"); downloading core code outside the signed bundle (breaks the signing model) |
| D3 | Official harnesses live in the monorepo under `harnesses/*` | One repo per harness (needs cross-repo triggers) |
| D4 | One version for the core and every harness (lockstep) | One version per harness |
| D5 | Windows ships in v1, with CI on Windows and a manual real-engine check; Windows-only bugs get their own spec | Packaging only; macOS only |
| D6 | No update UI: OS notification, install on quit | In-app "Restart to update" notice (parked, §9) |
| D7 | A `humanharness package` command builds the electron-builder config from the manifest | A hand-written `electron-builder.yml` per harness; env-var overrides in CI |

**Out of scope:**
- npm publishing and changesets. Official harnesses are in the monorepo and need no published packages. They come back with community harnesses.
- In-app update UI and "Move to Applications" on macOS (§9).
- Linux.
- Windows-specific engine bugs (install, login, paths) found by the checks in §7. Each gets its own spec.
- Rollback. A bad version is fixed by a newer one (§6).

## 2. Stages

Marco has the Apple Developer Program; Microsoft signing comes later. The work ships in two stages, each one plan:

1. **Stage 1 — macOS.** The `package` command, the updater, `ci.yml` and `release.yml` with the macOS leg, `pnpm release`, `docs/releasing.md`. Done when a tagged version installs, and updates itself, on a Mac.
2. **Stage 2 — Windows.** Azure Artifact Signing, the Windows leg of `release.yml`, the Windows job of `ci.yml`, the Windows checks in §7. Done when the same is true on Windows.

Everything below names its stage where it differs.

## 3. Components

### 3.1 `humanharness package --harness <dir> [--publish]` (`packages/cli`)

1. Loads the manifest and runs the same checks as `humanharness check`. A failing check stops it.
2. Builds the shell with that harness, the same `electron-vite build` that `dev` runs, with `HH_HARNESS_DIR` set to the harness.
3. Builds the electron-builder config in memory:
   - `appId`: `org.humanharness.<id>`; `productName`: the manifest's `name`; icon from the manifest's `logo`.
   - `version`: the `version` of the root `package.json` (new field; D4).
   - Targets: macOS `dmg` + `zip`, `universal` arch; Windows `nsis` (stage 2).
   - macOS: hardened runtime, the shell's entitlements files, `notarize: true`.
   - Windows: `azureSignOptions` (stage 2).
   - Publish: provider `generic`, `url` `https://github.com/Human-Harness/humanharness/releases/latest/download`, `channel` `<id>`. The app then reads `<id>-mac.yml` or `<id>.yml`, so several apps share one release without colliding.
4. Packages. The harness's files go into the app's `resources/`. `shellResourcesDir` already points there when `app.isPackaged`.
5. Signs only when the signing variables are present. Without them it warns and builds unsigned (local tests, community harnesses). With `--publish` and no signing variables it refuses (§6).
6. `--publish` uploads the artifacts to the draft release of the current version (§4).

The config is a pure function of (manifest, version, platform, publish flag), in its own module, so it is unit-tested without running electron-builder.

### 3.2 Updater (`packages/shell/src/main/updater.ts`)

- Runs only when `app.isPackaged`. In `dev`, mock mode and e2e it does nothing.
- On launch, then every 6 hours: `autoUpdater.checkForUpdatesAndNotify()`. The download runs in the background. The update installs when the app quits.
- `autoUpdater.channel` is not set at runtime: the channel comes from the packaged config, so `allowDowngrade` stays `false`.
- Logs through the shell's existing log. Never throws, never shows an error.

### 3.3 Manifest field `release`

`release: true` in `defineHarness` marks a harness as official, published by `release.yml`. Absent means not published. The minimal-core plan moves manifest keys under mods later; this one-line boolean moves with them.

### 3.4 Workflows (`.github/workflows/`)

- **`ci.yml`**, on every PR: typecheck, unit tests, e2e in mock mode, and an unsigned `package` of one harness. macOS in stage 1; Windows added in stage 2.
- **`release.yml`**, on tags `v*` (§4).

### 3.5 `pnpm release <version>` (`scripts/release.ts`)

Sets `version` in the root `package.json`, commits, tags `v<version>`, and prints the push command. It refuses a version that is not greater than the current one. Merging into master stays Marco's.

## 4. Release flow

1. `pnpm release 0.3.0` on master, then push the commit and the tag.
2. `release.yml`:
   1. **prepare**: checks that the tag equals the root `package.json` version, reads which harnesses have `release: true`, creates the GitHub release `v0.3.0` as a **draft**.
   2. **build**, a matrix of `{harness} × {macos-latest}` (stage 1) and `{windows-latest}` (stage 2): `humanharness package --harness harnesses/<id> --publish`. Each job uploads to the draft:
      - macOS: `Teacher-0.3.0-universal.dmg`, `Teacher-0.3.0-universal-mac.zip`, `teacher-mac.yml`
      - Windows: `Teacher-Setup-0.3.0.exe`, `teacher.yml`
   3. **publish**, only if every build job passed: publishes the draft. From then on `releases/latest/download/teacher-mac.yml` serves the new version.
3. Installed apps see it on their next check.

**Secrets**, in the protected GitHub environment `release`:
- macOS: `CSC_LINK`, `CSC_KEY_PASSWORD` (Developer ID Application certificate, .p12); `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` (App Store Connect API key, for notarization).
- Windows (stage 2): `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`; the Artifact Signing account and certificate profile names in the config.

## 5. Data the update touches

The update replaces the app only. The user's folder, `~/.humanharness/` and `.harness/` are never touched by the updater. A core change that changes their format ships its own migration; that is not the updater's job.

## 6. Errors and edge cases

**Packaging and publishing:**
- The tag differs from the root `version`: `prepare` fails, no draft is created.
- A manifest check, the build, signing or notarization fails: that job fails and the draft stays unpublished. Retry with "re-run failed jobs"; if code must change, delete the draft and tag the next version.
- Signing variables missing with `--publish`: `package` refuses to publish an unsigned build.

**Installed app:**
- No network, GitHub down, feed unreadable: logged, retried at the next 6-hour check. The user sees nothing.
- Download or signature check fails: electron-updater drops it and retries at the next check.
- A turn or task is running: nothing happens until quit; quitting already flushes turns and interrupts tasks (`flushTurns`, `interruptTasks`).
- A bad version reached users: ship a newer one (0.3.0 → 0.3.1). Written in `docs/releasing.md`.
- macOS, app run from outside `/Applications` (e.g. from the DMG): Squirrel.Mac cannot replace it. Logged; nothing else (§9).

## 7. Testing

**Automated:**
- `packages/cli` unit: the config builder — `appId`, `productName`, version, channel, feed URL, targets per platform, signing options present or absent; `release: true` filtering; tag/version mismatch; `--publish` without signing refuses.
- `packages/shell` unit: `updater.ts` with a fake `autoUpdater` — does nothing when not packaged, checks on launch and every 6 hours, logs errors without throwing.
- `ci.yml` on every PR (§3.4), including the unsigned `package` that catches a broken packaging step early.

**Manual, once per platform (checklist in `docs/releasing.md`):**
- End-to-end update: publish two test versions (e.g. 0.0.1 and 0.0.2) to a test repo or a local feed; install 0.0.1, open it, confirm it downloads and applies 0.0.2.
- The installed app opens on a clean machine without Gatekeeper (macOS) or SmartScreen (Windows) warnings.
- Windows (stage 2): install an engine CLI, sign in, finish one real turn.

## 8. Prerequisites before the first public release

Checklist in `docs/releasing.md`; none of these blocks writing the code.

1. Apple Developer Program (Marco has it): Developer ID Application certificate and an App Store Connect API key.
2. Azure Artifact Signing (stage 2): identity validation and a certificate profile.
3. The secrets in the `release` environment.
4. **Legal re-check** of Claude and Codex with the lawyer agent before the first public build. The core spec (§5) asks for written confirmation from Anthropic before distributing signed builds; that research is from 2026-10-10 and provider policies move fast. Distribution is free and open source with an optional donation link; the re-check confirms whether that changes anything.
5. The Windows real-engine check (§7).

## 9. Parked

- In-app update notice with "Restart to update" (needs mockups, Impeccable and light/dark screenshots).
- "Move to Applications" prompt on macOS.
- A shared runtime with harnesses as packages (D2, rejected for now): revisit when several harnesses ship.
- npm publishing for community harnesses.

## 10. Deliverables

- `humanharness package` and its config builder (`packages/cli`).
- `packages/shell/src/main/updater.ts`, wired into app start; `electron-updater` as a shell dependency; `electron-builder` as a dev dependency.
- macOS entitlements files for the hardened runtime.
- `release` in the manifest schema (`packages/harness-sdk`).
- `version` in the root `package.json`; `scripts/release.ts` and the `release` script.
- `.github/workflows/ci.yml` and `.github/workflows/release.yml`.
- `docs/releasing.md`: how to release, the manual checks, the prerequisites, the bad-version procedure.
- Roadmap: plan 4b points to this spec; Windows moves into v1. Core spec §11 "Releases" and §12 (Windows out of scope) point here.
