# Releasing

Design: [release and updates spec](superpowers/specs/2026-11-15-release-and-updates-design.md). Stage 1 is macOS; stage 2 (Windows) is marked below.

A harness is published when its manifest has `release: true`. A tag `v*` builds, signs, notarizes and publishes every such harness as one GitHub Release. Installed apps pick it up on their next update check.

## Release procedure

1. Be on `master`, up to date, with a clean tree.
2. Run `pnpm release 0.3.0`. It refuses a version that is not `major.minor.patch`, is not greater than the current one, a dirty tree, or any branch other than `master`. Otherwise it writes the version in the root `package.json`, commits `chore(release): v0.3.0`, tags `v0.3.0` and prints the command that publishes both. It never publishes anything itself.
3. Run the printed command: `git push origin master v0.3.0`.
4. The `Release` workflow (`.github/workflows/release.yml`) runs, in the protected `release` environment:
   - **prepare**: fails unless the tag equals the root `version`; lists the harnesses with `release: true` (and fails if there are none); creates the GitHub release as a **draft**.
   - **build**: one macOS job per harness. It runs `humanharness package --harness harnesses/<id> --publish`, which signs, notarizes and uploads the `.dmg`, the `.zip` and `<id>-mac.yml` to the draft.
   - **publish**: only if every build passed, publishes the draft. From then on `releases/latest/download/<id>-mac.yml` serves the new version.
5. Before announcing, do the [manual checks](#manual-checks).

Every PR to `master` also runs `ci.yml`: typecheck, unit tests, the e2e mock suite and an unsigned `package` of the demo, so a broken packaging step shows up before a release.

### When a job fails

- A flaky or external failure (network, notarization queue): in the Actions run, "Re-run failed jobs". The draft stays unpublished until every build passes.
- The code must change: delete the draft release and the tag (`git tag -d v0.3.0`, and remove it from the remote), fix on `master`, then release the next version (`pnpm release 0.3.1`).
- The tag and the root version differ (`prepare` fails, no draft was created): delete the tag, fix, release again.

### A bad version

There is no rollback. A version that reached users is fixed by a newer one: 0.3.0 is followed by 0.3.1. Installed apps update to it on their next check.

## Prerequisites

Before the first public release (spec §8). None of them blocks the code.

1. Apple Developer Program: a Developer ID Application certificate (`.p12`) and an App Store Connect API key (`.p8`).
2. **Stage 2:** Azure Artifact Signing: identity validation and a certificate profile.
3. The secrets in the GitHub environment `release`:
   - `CSC_LINK`, `CSC_KEY_PASSWORD`: the certificate and its password.
   - `APPLE_API_KEY` (the contents of the `.p8` file; the workflow writes it to a temporary file and points `APPLE_API_KEY` at its path), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.
   - **Stage 2:** `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`.
4. The legal re-check of Claude and Codex with the lawyer agent before the first public build (core spec §5 asks for written confirmation from Anthropic before distributing signed builds).
5. **Stage 2:** the Windows real-engine check (see the checks below).
6. At least one harness with `release: true`.

## Manual checks

Once per platform, before announcing a release (spec §7).

- **The app opens on a clean machine** with no Gatekeeper warning (macOS). **Stage 2:** no SmartScreen warning (Windows).
- **End-to-end update, with a local feed.** Build two test versions against a local feed and update from the first to the second:
  1. Set the root `package.json` version to 0.0.1 (the app takes its version from there) and run `pnpm humanharness package --harness harnesses/demo --out dist-0.0.1 --feed http://localhost:8080`.
  2. Set it to 0.0.2 and run the same with `--out dist-0.0.2`.
  3. Serve the second build: `npx http-server dist-0.0.2 -p 8080`.
  4. Install the app from `dist-0.0.1` into `/Applications` and open it.
  5. Wait for the update notification (the check runs at launch and every 6 hours).
  6. Quit the app, open it again and confirm the version is 0.0.2.
  7. Put the versions back.
- **Stage 2, Windows:** install an engine CLI, sign in and finish one real turn.
