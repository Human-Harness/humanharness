# Closed-world style guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every screen of the core and the demo is built only from the closed set of pieces, measures, tokens, icons, templates and zones of the style guide spec, with an automated guard that keeps it closed, a dev-mode guide page and `docs/style-guide.md`.

**Status:** draft, waiting for Marco's review. Not started. The open questions at the end block the tasks that name them; every other task can run as written.

**Spec:** `docs/superpowers/specs/2026-11-02-style-guide-design.md` (branch `docs/style-guide-spec`, commit 6cf99672). Guide artifact v29: https://claude.ai/artifact/2j18xQrjeqXPLnYaKuDkfL. Decisions page: https://claude.ai/artifact/XbHnScLhQXDTCAvUTv6aDD.

**Architecture:** Tokens stay CSS custom properties in the token block of `packages/ui/src/styles.css`, mirrored in `packages/ui/src/plugin-ui/tokens.css`. Each guide piece becomes one React component under a new folder `packages/ui/src/guide/`, with its CSS rules in one block of `styles.css` and its classes listed in `packages/ui/src/guide/classes.ts`. One icon set lives in `packages/ui/src/guide/icons.tsx` with the closed names of spec §4. A guard test (`packages/ui/test/style-guard.test.ts`) reads the CSS and TSX sources and fails on any loose color, off-scale size, wrong weight or class outside the guide; it starts with a list of known offenders that may only shrink. Then templates, zones and screens move onto the pieces following the §13 migration list, then the plugin kit, then the guide page and docs.

**Tech Stack:** React 18 + TypeScript, plain CSS, Vitest + Testing Library (happy-dom), Playwright e2e (`packages/e2e`), Electron renderer with a strict CSP (fonts bundled via `@fontsource`), i18next (`packages/i18n/src/locales/en.json`).

---

## Rules for whoever implements this

1. **Decide nothing about UI.** The spec is the source of truth. When the spec does not say a visual detail (a hover color, a glyph, a gap inside a piece), look at the guide artifact v29. If the artifact does not show it either, stop that step and add a question to the PR body under "Questions for Marco" (and see OQ-15). Never pick a value, piece, color, size or copy yourself.
2. **Strings.** The app ships English (language-on-demand spec). The spec writes the copy in Spanish. Every new or changed string goes in `packages/i18n/src/locales/en.json` with the English text Marco gives in OQ-1. Until OQ-1 is answered, tasks that add copy are blocked at their "strings" step; the rest of the task can land with the existing keys.
3. **One part = one PR**, stacked: each branch starts from the previous one, each PR targets the previous branch, the first targets `master`. An agent may push the branch and open the PR; only Marco reviews and merges.
4. **Each part leaves the app working:** its gate is green and the demo runs (`corepack pnpm start-demo`) in light and dark with no broken screen.
5. **The offenders list only shrinks.** From Part 3 on, every task that fixes a loose value removes its line from `packages/ui/test/style-guard-offenders.json` in the same commit. Never add a line to it.
6. **Re-check anchors.** File and class names below were read on `origin/master` at 148e2844. Before each part, open the files it names; where a name moved, use the new one and note it in the PR body under "Conflicts with the plan".

## Before you start (gate)

- [ ] **Step 1: The spec is merged.** Run: `git fetch origin && git log origin/master --oneline -- docs/superpowers/specs/2026-11-02-style-guide-design.md | head -1`. Expected: one commit. If empty, stop: the spec branch `docs/style-guide-spec` is not merged yet.
- [ ] **Step 2: The open questions this part needs are answered** (see "Blocked by" in each part's header). If not, stop that part.
- [ ] **Step 3: Branch and baseline.**

```bash
git switch -c feat/sg-tokens origin/master
corepack pnpm install
corepack pnpm typecheck && corepack pnpm test && corepack pnpm e2e
```

Expected: all green. Write down the unit test count and the e2e count in the PR body.

## Gates

| Gate | Command | When |
|---|---|---|
| Unit (one file) | `corepack pnpm exec vitest run packages/ui/test/<file>` | Each task step that says "run" |
| Part gate | `corepack pnpm typecheck && corepack pnpm test && corepack pnpm e2e` | End of every part, before pushing |
| Look check | `corepack pnpm exec playwright test -c packages/e2e/playwright.config.ts packages/e2e/tests/look.spec.ts` after `corepack pnpm --filter @humanharness/shell build`; screenshots land in `packages/e2e/test-results/look/` | End of every part from Part 1 on; attach light and dark screenshots of the screens the part touched to the PR body |
| Manual | `corepack pnpm start-demo`, check the touched screens in light and dark (System Settings › Appearance) | End of every part |

## Shared hotspots

A part that touches a hotspot must not run in parallel with another part touching the same hotspot. All parts below are stacked, so inside this plan they never collide; the list is for scheduling this plan against other work.

| Id | Hotspot | Path |
|---|---|---|
| H1 | styles.css token block | `packages/ui/src/styles.css` lines 1–133 (`:root` and the dark `@media` block) |
| H2 | styles.css rules (rest of the file) | `packages/ui/src/styles.css` after line 133 |
| H3 | Package manifests and lockfile | `packages/*/package.json`, `pnpm-lock.yaml` |
| H4 | Generated or built files | `harnesses/demo/plugins/on-this-day/dist/**`, `packages/e2e/fixtures/plugins/probe/dist/**`, `packages/ui/test/style-guard-offenders.json` (written once by a script, then shrunk by hand) |
| H5 | Routing and screen state | `packages/ui/src/HarnessApp.tsx`, `packages/ui/src/shell-nav.ts`, `packages/ui/src/settings-tabs.ts`, `packages/ui/src/client.ts` (`SearchSettingsTab`) |
| H6 | l10n | `packages/i18n/src/locales/en.json`, `harnesses/demo/locales/**` |
| H7 | CI and repo config | `.github/**` (today only `workflows/pages.yml`) |
| H8 | CLAUDE.md | none in the repo today; no part touches it |
| H9 | Public SDK / exports | `packages/harness-sdk/src/**`, `packages/ui/src/index.ts`, `packages/ui/src/plugin-ui/index.ts` |
| H10 | `ChatView.tsx` (2 201 lines, most work-screen zones) | `packages/ui/src/ChatView.tsx` |

## Parts and branches

| Part | Stage (§16) | Branch | Base | Area (paths) | Hotspots | Spec | §13 rows | Blocked by |
|---|---|---|---|---|---|---|---|---|
| 1 Tokens and scale | 1 | `feat/sg-tokens` | `origin/master` | `packages/ui/src/styles.css`, `packages/ui/src/plugin-ui/tokens.css`, `packages/ui/src/profiles.ts`, `packages/ui/src/review-marks.ts`, `packages/shell/src/renderer/main.tsx`, `packages/shell/package.json`, `harnesses/demo/ui/demo.css`, `packages/cli/template/ui/harness.css`, `packages/ui/test/styles.test.ts`, `packages/ui/test/plugin-ui-tokens.test.ts`, `packages/ui/test/profiles*.test.tsx` | H1, H2, H3, H6 (no new strings) | §2 | 11, 31, 45, 46, 47, 48 (values), 54 | OQ-2, OQ-3, OQ-4, OQ-5, OQ-6 |
| 2 Guard test | 2 | `feat/sg-guard` | `feat/sg-tokens` | `packages/ui/test/style-guard.test.ts` (new), `packages/ui/test/style-guard-offenders.json` (new), `packages/ui/test/style-guard-lib.ts` (new), `packages/ui/scripts/style-guard-init.ts` (new), `packages/ui/src/guide/classes.ts` (new) | H4 | §15 Control, §16.2 | — | OQ-2 |
| 3 Icons | 3 | `feat/sg-icons` | `feat/sg-guard` | `packages/ui/src/guide/icons.tsx` (new), `packages/ui/src/chrome.tsx`, `packages/ui/src/ActivityList.tsx`, `packages/ui/src/assets/loader.gif` (removed), `packages/ui/src/sidekick/mark.tsx`, `packages/ui/src/markdown.tsx`, `packages/ui/src/EngineTab.tsx`, `packages/ui/src/plugins/PluginDetail.tsx`, `packages/ui/src/InputForm.tsx`, `packages/ui/src/MaterialPanel.tsx`, `packages/ui/src/Drawer.tsx`, `packages/ui/src/sidekick/SidekickPanel.tsx`, `packages/harness-sdk/src/sidekick.ts`, `harnesses/demo/ui/DiagramBlock.tsx` (read only), tests | H2, H9 | §4 | 12, 13, 14, 15, 26, 44 | OQ-7, OQ-8, OQ-10, OQ-19 |
| 4 Buttons and choosers | 3 | `feat/sg-buttons` | `feat/sg-icons` | `packages/ui/src/guide/Button.tsx`, `Segmented.tsx`, `Tabs.tsx`, `NavItem.tsx`, `Option.tsx`, `Tile.tsx`, `Toggle.tsx`, `Checkbox.tsx` (all new), `packages/ui/src/chrome.tsx`, files using the §3 "today" classes (listed per task), tests | H2, H10 | §3, §5 (toggle, checkbox, radio) | 9, 10, 20, 21, 22, 23, 56, 80 | OQ-1 (strings only), OQ-20 |
| 5 Forms | 3 | `feat/sg-forms` | `feat/sg-buttons` | `packages/ui/src/guide/Field.tsx`, `FormField.tsx`, `fields/*.tsx`, `SettingsRow.tsx` (new), `packages/ui/src/InputForm.tsx`, `packages/ui/src/InputBlock.tsx`, `packages/ui/src/settings-parts.tsx`, `packages/ui/src/HarnessSettingsTab.tsx`, `packages/ui/src/SetupStepForm.tsx`, `packages/ui/src/connections/SecretField.tsx`, `packages/ui/src/ModelsTab.tsx`, tests | H2, H6, H9 (only if OQ-9 says so) | §5 | 24, 50, 51, 52, 53, 55 | OQ-1, OQ-9, OQ-10 |
| 6 Indicators and card | 3 | `feat/sg-indicators` | `feat/sg-forms` | `packages/ui/src/guide/Tag.tsx`, `Chip.tsx`, `Counter.tsx`, `Dot.tsx`, `StepMark.tsx`, `ProgressBar.tsx`, `Ring.tsx`, `Avatar.tsx`, `Table.tsx`, `Card.tsx` (new), `packages/ui/src/chrome.tsx` (`Tag`, `MockBadge`), `packages/ui/src/RecommendModeBlock.tsx`, `packages/ui/src/SetupStepsList.tsx`, `packages/ui/src/settings-parts.tsx`, `packages/ui/src/connections/ConnectionsTab.tsx`, `packages/ui/src/ProfileSwitcher.tsx`, `packages/ui/src/ProfilesSection.tsx`, `packages/ui/src/plugins/AttentionInbox.tsx`, tests | H2 | §6 | 18, 19, 27, 30, 49, 54 | OQ-1 (strings only) |
| 7 Messages and overlays | 3 | `feat/sg-messages` | `feat/sg-indicators` | `packages/ui/src/guide/StatusLine.tsx`, `Notice.tsx`, `InlineConfirm.tsx`, `EmptyState.tsx`, `Dialog.tsx`, `Popover.tsx`, `Menu.tsx`, `AnnotationTooltip.tsx` (new), every file with `role="alert"` (listed in Task 30), `packages/ui/src/search/SearchPalette.tsx`, `packages/ui/src/search/SearchHost.tsx`, `packages/ui/src/LanguagePicker.tsx`, `packages/ui/src/TranslateNotice.tsx`, `packages/ui/src/AnnotateBlock.tsx`, tests | H2, H6, H10 | §7, §8 | 16, 17, 29, 39, 40 | OQ-1 |
| 8 Shell: top bar, rail, templates | 4 | `feat/sg-shell` | `feat/sg-messages` | `packages/ui/src/chrome.tsx`, `packages/ui/src/shell-nav.ts`, `packages/ui/src/guide/templates/*.tsx` (new), `packages/ui/src/guide/OneLineBar.tsx` (new), `packages/ui/src/HarnessApp.tsx`, `packages/ui/src/parallel/Inbox.tsx`, `packages/ui/src/SettingsPage.tsx` (top bar only), tests, `packages/e2e/tests/*.spec.ts` that click the rail or the top bar | H2, H5, H6, H9 | §9, §10.1, §10.2, §3 one-line bars | 6, 30 (placement), 31 (layout), 34 (button), 36, 38 (piece), 74 | OQ-1, OQ-11, OQ-21 |
| 9 Work screen: header, bars, chat, composer | 4 | `feat/sg-work` | `feat/sg-shell` | `packages/ui/src/TaskHeader.tsx`, `packages/ui/src/parallel/TaskStrip.tsx`, `packages/ui/src/PhaseStepper.tsx`, `packages/ui/src/ModeList.tsx`, `packages/ui/src/ChatView.tsx`, `packages/ui/src/Message.tsx`, `packages/ui/src/ActivityList.tsx`, `packages/ui/src/tools/*.tsx`, `packages/ui/src/markdown.tsx`, `packages/ui/src/ChoicesBlock.tsx`, `packages/ui/src/InputBlock.tsx`, `packages/ui/src/ErrorCard.tsx`, `packages/ui/src/DocumentCards.tsx`, `packages/ui/src/StartView.tsx`, `packages/ui/src/UsageMeter.tsx`, `packages/ui/src/plugins/PluginChips.tsx`, `packages/ui/src/plugins/PreparedTask.tsx`, `packages/ui/src/ScopePicker.tsx`, `packages/ui/src/hatches/ScopeSettings.tsx`, `packages/ui/src/index.ts`, tests, e2e | H2, H6, H9, H10 | §10.3–§10.7 | 8, 28, 33, 35, 38, 65, 66, 67, 68, 69, 70, 71, 72, 73 | OQ-1, OQ-12, OQ-23 |
| 10 Side columns and Sidekick | 4 | `feat/sg-columns` | `feat/sg-work` | `packages/ui/src/FlowSide.tsx`, `packages/ui/src/sidekick/SidekickPanel.tsx`, `packages/ui/src/sidekick/PresetOffer.tsx`, `packages/ui/src/sidekick/ReviewHint.tsx`, `packages/ui/src/sidekick/FlaggedText.tsx`, `packages/ui/src/sidekick/word-diff.ts`, `packages/ui/src/ChatView.tsx` (column slots), `packages/ui/src/HarnessApp.tsx` (`renderSide`), tests, e2e | H2, H5, H6, H9, H10 | §10.8, §10.9, Sidekick column | 5, 32, 37 (column), 41, 42, 43, 44 (placement), 58 (Sidekick) | OQ-1, OQ-11, OQ-21, OQ-23 |
| 11 Split view: reader, review, context | 4 | `feat/sg-split` | `feat/sg-columns` | `packages/ui/src/guide/templates/SplitView.tsx`, `packages/ui/src/DocumentReader.tsx`, `packages/ui/src/ContextPanel.tsx`, `packages/ui/src/ReviewBar.tsx`, `packages/ui/src/ReviewColumn.tsx`, `packages/ui/src/FocusMarkers.tsx`, `packages/ui/src/review-marks.ts`, `packages/ui/src/FileDiff.tsx`, `packages/ui/src/EntryDiff.tsx`, `packages/ui/src/ApprovedDiff.tsx`, `packages/ui/src/ChatView.tsx` (split slot), tests, e2e | H2, H6, H10 | §10.10, §2 special uses | 4, 57, 58 (diff viewer), 59, 60, 61, 62, 63, 64 | OQ-1, OQ-4, OQ-13, OQ-22 |
| 12 Secondary pages | 4 | `feat/sg-pages` | `feat/sg-split` | `packages/ui/src/pages/FilesPage.tsx`, `HistoryPage.tsx`, `PluginsPage.tsx`, `JobsPage.tsx` (new), `packages/ui/src/parallel/InboxBoard.tsx` (becomes the Bandeja list), `packages/ui/src/parallel/JobsTab.tsx`, `packages/ui/src/NotesPanel.tsx`, `packages/ui/src/MaterialPanel.tsx`, `packages/ui/src/hatches/LinkedFolders.tsx`, `packages/ui/src/HistoryPanel.tsx`, `packages/ui/src/FileTimelinePanel.tsx`, `packages/ui/src/Drawer.tsx` (removed), `packages/ui/src/plugins/PluginsSection.tsx`, `packages/ui/src/plugins/PanelFrame.tsx`, `packages/ui/src/HarnessApp.tsx`, `packages/ui/src/shell-nav.ts`, `packages/ui/src/settings-tabs.ts`, tests, e2e | H2, H5, H6, H10 | §11 | 1, 2, 3, 7, 37 (page) | OQ-1 |
| 13 Inicio and Assistant | 4 | `feat/sg-home-setup` | `feat/sg-pages` | `packages/ui/src/Home.tsx`, `packages/ui/src/PickUp.tsx`, `packages/ui/src/BackupNotice.tsx`, `packages/ui/src/LanguageChooser.tsx`, `packages/ui/src/SetupFlow.tsx`, `packages/ui/src/SetupStepsList.tsx`, `packages/ui/src/SetupStepForm.tsx`, `packages/ui/src/SetupInterviewStep.tsx`, `packages/ui/src/EngineOnboarding.tsx`, `packages/ui/src/FolderStep.tsx`, `packages/ui/src/ProfileStep.tsx`, `packages/ui/src/connections/ConnectStep.tsx`, tests, e2e | H2, H6 | §12 Inicio, Assistant | 19 (end), 20 (use), 21 (engine in Assistant), 76 (Assistant), 81, 82, 83 | OQ-1, OQ-14, OQ-24 |
| 14 Settings | 4 | `feat/sg-settings` | `feat/sg-home-setup` | `packages/ui/src/SettingsPage.tsx`, `packages/ui/src/settings-parts.tsx`, `packages/ui/src/settings-tabs.ts`, `packages/ui/src/EngineTab.tsx`, `packages/ui/src/hatches/EngineConfig.tsx`, `packages/ui/src/hatches/BackendCard.tsx`, `packages/ui/src/ModelsTab.tsx`, `packages/ui/src/UsageTab.tsx`, `packages/ui/src/connections/ConnectionsTab.tsx`, `packages/ui/src/sidekick/SidekickTab.tsx`, `SidekickList.tsx`, `SidekickEditor.tsx`, `LearnedList.tsx`, `ImportSidekick.tsx`, `ScopeSidekicks.tsx`, `packages/ui/src/plugins/PluginsTab.tsx`, `PluginDetail.tsx`, `PermissionReview.tsx`, `packages/ui/src/ProfilesSection.tsx`, `packages/ui/src/HarnessSettingsTab.tsx`, tests, e2e | H2, H5, H6 | §12 Settings | 43 (plan usage), 49 (Modelos), 52, 53, 55, 75, 76, 77, 78, 79, 80 | OQ-1, OQ-14, OQ-23 |
| 15 Plugin kit and demo | 5 | `feat/sg-plugin-kit` | `feat/sg-settings` | `packages/ui/src/plugin-ui/components.tsx`, `plugin-ui.css`, `tokens.css`, `index.ts`, `harnesses/demo/ui/*.tsx`, `harnesses/demo/ui/demo.css`, `harnesses/demo/plugins/on-this-day/panels/*`, `harnesses/demo/plugins/on-this-day/dist/*` (rebuilt), `packages/e2e/fixtures/plugins/probe/**`, `packages/cli/template/ui/harness.css`, `packages/ui/test/plugin-ui*.test.ts*`, `harnesses/demo/test/**` | H2 (none: kit has its own CSS), H4, H9 | §15 Plugin panels, Harness chat blocks | 25, 26 | OQ-16, OQ-17 |
| 16 Guide page and docs | 6 | `feat/sg-guide` | `feat/sg-plugin-kit` | `packages/ui/src/guide/GuidePage.tsx` (new), `packages/ui/src/SettingsPage.tsx`, `packages/ui/src/settings-tabs.ts`, `packages/ui/src/client.ts`, `docs/style-guide.md` (new), `.github/pull_request_template.md` (new), `packages/ui/test/guide-page.test.tsx` (new), `packages/ui/test/style-guard.test.ts` | H5, H6, H7 | §15 Where it lives, §15 Control (checklist), §16.6 | 48 (doc) | OQ-1, OQ-18 |

Part 15 has no file in common with Parts 8–14 except `style-guard-offenders.json` (H4). If Marco wants it earlier, it may branch from `feat/sg-messages` and run in parallel with Parts 8–14; on rebase, resolve the offenders file by keeping only lines present on both sides.

Each part ends with the part gate green, the look check screenshots, the offenders list shorter than at the part's start (Parts 3–16), and a PR body written to the scratch folder with: spec sections and §13 rows done, the tests added, the offenders removed count, "Conflicts with the plan", "Questions for Marco".

---

## Part 1 — Tokens and scale (`feat/sg-tokens`, from `origin/master`)

**Area:** `packages/ui/src/styles.css`, `packages/ui/src/plugin-ui/tokens.css`, `packages/ui/src/plugin-ui/plugin-ui.css`, `packages/ui/src/profiles.ts`, `packages/harness-sdk/src/profiles.ts` (only if OQ-5 says so), `packages/shell/src/renderer/main.tsx`, `packages/shell/package.json`, `pnpm-lock.yaml`, `harnesses/demo/ui/demo.css`, `harnesses/demo/plugins/on-this-day/panels/events.css`, `packages/cli/template/ui/harness.css`, `packages/ui/test/styles.test.ts`, `packages/ui/test/plugin-ui-tokens.test.ts`, `packages/ui/test/profiles.test.tsx`.
**Hotspots:** H1, H2, H3 (`@fontsource/dm-mono` added, `700.css` import dropped), H9 (only with OQ-5 option B).
**Spec:** §2 (all), §1 "a harness may change values through tokens", §16.1. **Rows:** 31 (value), 45, 46, 47, 48 (values side), 54.
**Blocked by:** OQ-2 (measure tokens), OQ-3 (off-scale values), OQ-4 (tokens outside the tables), OQ-5 (avatar colors), OQ-6 (17/18 px text).

Scope note: this part changes tokens and the values the spec maps one to one (11 → 12 px text, 700 → 600, segmented 28/6 → 30/8, the width tokens). Every other loose measure is fixed when its piece is rebuilt in Parts 4–7, because only there does the spec say which measure it takes. Part 2's offenders list records what is left.

### Task 1: Color tokens are exactly the §2 tables, light and dark

**Files:**
- Modify: `packages/ui/src/styles.css:1-133` (token block)
- Test: `packages/ui/test/styles.test.ts` (describe `design tokens`)

- [ ] **Step 1: Write the failing test.** Replace the `design tokens` describe's palette test and the two tests that read `highlight` and `diff-*`/`review-*`/`callout-*` with:

```ts
// spec §2 Color: the only color tokens. Tag tokens keep today's names (--hh-t-<color>, --hh-t-<color>-ink).
const GUIDE_COLORS = [
  "bg", "rail", "column", "surface", "surface-2", "line", "line-strong", "ink", "muted", "faint",
  "cta", "cta-ink", "cta-hover", "active", "active-ink",
  "t-green", "t-green-ink", "t-orange", "t-orange-ink", "t-blue", "t-blue-ink",
  "t-violet", "t-violet-ink", "t-red", "t-red-ink",
];
const NON_COLOR = ["shadow", "backdrop", "font", "mono", "display"]; // plus the measure tokens of OQ-2
const colorTokens = (block: string) =>
  [...block.matchAll(/--hh-([a-z0-9-]+):\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\)|var\(--hh-[a-z0-9-]+\))/gi)].map((m) => m[1]);

it("defines exactly the guide's color tokens in light and dark (style guide §2)", () => {
  for (const block of [light, dark]) {
    const names = colorTokens(block).filter((n) => !NON_COLOR.includes(n) && !n.endsWith("-w") && !n.endsWith("-h") && !n.endsWith("-r"));
    expect(new Set(names)).toEqual(new Set(GUIDE_COLORS));
  }
});

it("drops the single-use tokens (style guide §2 'Tokens that go', row 45)", () => {
  for (const gone of ["callout-", "review-", "diff-", "profile-", "highlight", "logo", "on-ink", "ok:", "ok-dot", "warn:", "error-bg", "shadow-sm"])
    expect(css).not.toMatch(new RegExp(`--hh-${gone}`));
});
```

Keep the existing `LIGHT`/`DARK` hex maps but delete the `logo` and `logo-ink` entries; keep the contrast test. Delete the tests `keeps highlight equal to active`, `defines the diff tokens…`, `annotate marks › the highlight under a gap…` (replace with: ink on `active` ≥ 7:1 in both blocks) and `profile avatars` (moved to Task 2).

- [ ] **Step 2: Run it.** `corepack pnpm exec vitest run packages/ui/test/styles.test.ts` — Expected: FAIL, `callout-note` and the others still defined.
- [ ] **Step 3: Implement.** In the token block delete `--hh-logo`, `--hh-logo-ink`, `--hh-highlight`, every `--hh-profile-*`, `--hh-callout-*`, `--hh-review-*`, `--hh-diff-*`, `--hh-shadow-sm`, `--hh-on-ink`, `--hh-ok`, `--hh-ok-dot`, `--hh-warn`, `--hh-error-bg` (light and dark). Replace their uses in the rest of `styles.css`:

| Was | Becomes | Why |
|---|---|---|
| `var(--hh-ok)`, `var(--hh-ok-dot)` | `var(--hh-t-green-ink)` | same value today |
| `var(--hh-warn)` | `var(--hh-t-orange-ink)` | same value today |
| `var(--hh-error-bg)` | `var(--hh-t-red)` | same value today |
| `var(--hh-on-ink)` | `var(--hh-bg)` | same value today |
| `var(--hh-highlight)` | `var(--hh-active)` | spec §2 |
| `var(--hh-review-question)` / `-comment` / `-done` / `-active` | `var(--hh-t-orange)` / `var(--hh-t-blue)` / `var(--hh-surface-2)` / `var(--hh-active)` as background, plus `box-shadow: inset 0 -2px 0 var(--hh-t-<type>-ink)` (grey: `var(--hh-ink)`; active: `var(--hh-active-ink)`) | spec §2 review marks, row 59 |
| `var(--hh-diff-ins)` / `var(--hh-diff-del)` | `var(--hh-t-green)` / `var(--hh-t-red)` | spec §2 diffs |
| `var(--hh-diff-bar-ins)` / `var(--hh-diff-bar-del)` | per OQ-4 (border color of a diff line) | |
| `var(--hh-callout-*)` | per OQ-4 (which tag color each callout takes) | |
| `var(--hh-logo)`, `var(--hh-logo-ink)`, `var(--hh-shadow-sm)` | per OQ-4 | |
| `var(--hh-profile-*)` | Task 2 | |

- [ ] **Step 4: Run it.** Same command — Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(ui): color tokens are the guide's closed list (style guide §2)"`

**Gate:** `corepack pnpm exec vitest run packages/ui/test/styles.test.ts packages/ui/test/markdown.test.tsx packages/ui/test/file-diff.test.tsx packages/ui/test/review-marks.test.ts`

### Task 2: Six avatar colors with tag ink

**Files:**
- Modify: `packages/ui/src/profiles.ts:5-6` and the avatar rule in `packages/ui/src/styles.css` (search `hh-avatar`)
- Modify (OQ-5 option B only): `packages/harness-sdk/src/profiles.ts` (`PROFILE_COLORS`)
- Test: `packages/ui/test/profiles.test.tsx`, `packages/ui/test/styles.test.ts`

- [ ] **Step 1: Failing test** in `styles.test.ts`:

```ts
describe("profile avatars (style guide §2 special uses)", () => {
  it("six colors, each a tag fill with its tag ink; grey is surface-2 + ink", () => {
    expect([...AVATAR_COLORS]).toEqual(["green", "orange", "blue", "violet", "red", "gray"]);
    for (const c of ["green", "orange", "blue", "violet", "red"])
      expect(css).toMatch(new RegExp(`\\.hh-avatar\\[data-color="${c}"\\]\\s*{[^}]*background:\\s*var\\(--hh-t-${c}\\);[^}]*color:\\s*var\\(--hh-t-${c}-ink\\)`));
    expect(css).toMatch(/\.hh-avatar\[data-color="gray"\]\s*{[^}]*background:\s*var\(--hh-surface-2\);[^}]*color:\s*var\(--hh-ink\)/);
  });
});
```

Add to `profiles.test.tsx` a case per OQ-5's answer: a stored profile with `color: "coral"` draws the avatar color OQ-5 names.

- [ ] **Step 2: Run** `corepack pnpm exec vitest run packages/ui/test/styles.test.ts packages/ui/test/profiles.test.tsx` — FAIL.
- [ ] **Step 3: Implement.** `AVATAR_COLORS = ["green", "orange", "blue", "violet", "red", "gray"] as const;` One rule per color using `data-color` (read today's avatar markup in `ProfileSwitcher.tsx` / `ProfilesSection.tsx`; if it uses an inline `style` with the token, switch it to `data-color`). Old stored values follow OQ-5.
- [ ] **Step 4: Run** — PASS. Also run `corepack pnpm exec vitest run packages/ui/test/profiles-settings.test.tsx packages/ui/test/profile-setup.test.tsx`.
- [ ] **Step 5: Commit** `feat(ui): six avatar colors with tag ink (style guide §2, row 45)`.

**Gate:** the two runs above.

### Task 3: Width tokens; rail 64

**Files:**
- Modify: `packages/ui/src/styles.css` token block and the rules that hard-code these widths (search `76px`, `280px`, `290px`, `320px`, `330px`, `680px`, `440px`, `640px`, `55%`)
- Test: `packages/ui/test/styles.test.ts`

- [ ] **Step 1: Failing test:**

```ts
describe("widths (style guide §2 Widths)", () => {
  it("defines the closed width tokens", () => {
    expect(css).toMatch(/:root\s*{[^}]*--hh-rail-w:\s*64px/);
    expect(css).toMatch(/:root\s*{[^}]*--hh-column-w:\s*clamp\(220px,\s*280px,\s*320px\)|--hh-column-w:\s*280px/);
    expect(css).toMatch(/:root\s*{[^}]*--hh-split-w:\s*55%/);
    expect(css).toMatch(/:root\s*{[^}]*--hh-read-w:\s*680px/);
    expect(css).toMatch(/:root\s*{[^}]*--hh-dialog-w:\s*440px/);
    expect(css).toMatch(/:root\s*{[^}]*--hh-popover-w:\s*320px/);
  });
  it("the rail uses its token", () => {
    expect(css).toMatch(/^\.hh-rail\s*{[^}]*width:\s*var\(--hh-rail-w\)/m);
  });
});
```

The spec gives `--hh-column-w` as "280 (min 220 · max 320)": define `--hh-column-w: 280px;` and use `min-width: 220px; max-width: 320px;` on the columns that use it (the first alternative in the regex is not used; drop it when writing the test). Search's 640 is a second dialog width: add `--hh-dialog-w-search: 640px` only if OQ-2 answers A; otherwise the search rule keeps `640px` literally and the guard allows it (Task 8 list).

- [ ] **Step 2: Run** — FAIL (`--hh-rail-w` is 76 today or missing).
- [ ] **Step 3: Implement:** add the tokens; replace the hard-coded widths in the rail, `.hh-side`, `.hh-flow-side`, the Sidekick column, the reading column, dialogs and the top-bar popovers with the tokens. Update the existing test `flow layout › the side columns give way…` to expect `var(--hh-column-w)`.
- [ ] **Step 4: Run** `styles.test.ts` and `chrome.test.tsx` — PASS.
- [ ] **Step 5: Commit** `feat(ui): width tokens, rail 64 (style guide §2, row 31)`.

**Gate:** `corepack pnpm exec vitest run packages/ui/test/styles.test.ts packages/ui/test/chrome.test.tsx`

### Task 4: Type scale and weights; DM Mono; inline code

**Files:**
- Modify: `packages/ui/src/styles.css` (every `font-size: 11px`, `font-weight: 700`, the `code` rule at line ~139, `--hh-font`, new `--hh-mono`)
- Modify: `packages/shell/src/renderer/main.tsx:4-7`, `packages/shell/package.json`, `pnpm-lock.yaml`
- Test: `packages/ui/test/styles.test.ts`, `packages/shell/test/*` if one reads the imports (grep `fontsource` in `packages/shell/test`)

- [ ] **Step 1: Failing test:**

```ts
describe("type (style guide §2 Type)", () => {
  it("only 12, 13, 14, 15, 16, 20 and 28 px text", () => {
    const sizes = new Set([...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1])));
    for (const s of sizes) expect([12, 13, 14, 15, 16, 20, 28], `${s}px`).toContain(s);
  });
  it("only weights 400, 500 and 600", () => {
    const w = new Set([...css.matchAll(/font-weight:\s*(\d+)/g)].map((m) => Number(m[1])));
    for (const v of w) expect([400, 500, 600]).toContain(v);
  });
  it("inline code: DM Mono 400, one point below, surface-2, radius 4", () => {
    expect(css).toMatch(/--hh-mono:\s*"DM Mono",/);
    expect(css).toMatch(/^:not\(pre\)\s*>\s*code\s*{[^}]*font-family:\s*var\(--hh-mono\)[^}]*font-size:\s*calc\(1em - 1px\)[^}]*background:\s*var\(--hh-surface-2\)[^}]*border-radius:\s*4px/m);
  });
});
```

Add to the shell's renderer test (or a new `packages/shell/test/fonts.test.ts`): `main.tsx` imports `@fontsource/dm-sans/{400,500,600}.css` and `@fontsource/dm-mono/400.css`, and not `700.css`.

- [ ] **Step 2: Run** — FAIL (11, 17, 18, 40 px; 700 loaded).
- [ ] **Step 3: Implement.**
  - `corepack pnpm --filter @humanharness/shell add @fontsource/dm-mono` (H3); in `main.tsx` drop `700.css`, add `import "@fontsource/dm-mono/400.css";`.
  - `--hh-mono: "DM Mono", ui-monospace, SFMono-Regular, Menlo, monospace;` in the token block. Code blocks (`pre code`) and keys (`kbd`) use `var(--hh-mono)` (spec: DM Mono only for code and keys).
  - Inline code rule as in the test; `pre > code` keeps the block style.
  - Every `font-size: 11px` → `12px` (row 11). Any `font-weight` other than 400/500/600 → 600 (row 46). Tags: `.hh-tag` weight 600 (row 54).
  - 28 px task title → 20 (`.hh-task-title`, row 8); `.hh-section-head h2` 28 → removed with its title in Part 14 (row 75) — for now 20; `.hh-inbox-head h1` 28 → 20 (secondary page title, §11); `.hh-home-name` 40 → 28 (row 81); `.hh-reader-head-title` 18 → 20 (panel title, §2); `.hh-langpick h2` 17 → 20 (dialog title, §2). `.hh-reader-large` (18 px, a reader text-size option) per OQ-6.
- [ ] **Step 4: Run** `styles.test.ts`, the shell font test, and `home-look.test.tsx`, `task-header.test.tsx`, `document-reader.test.tsx` — PASS.
- [ ] **Step 5: Commit** `feat(ui): type scale, weights 400/500/600, DM Mono and inline code (style guide §2, rows 11, 46, 47, 54)`.

**Gate:** `corepack pnpm exec vitest run packages/ui/test/styles.test.ts packages/shell` and `corepack pnpm typecheck`

### Task 5: Measure tokens a harness can change

**Blocked by OQ-2.** If OQ-2 = B (no measure tokens beyond the widths and today's `--hh-control-h` / `--hh-control-r`), skip this task and note it in the PR.

**Files:**
- Modify: `packages/ui/src/styles.css` token block
- Test: `packages/ui/test/styles.test.ts`

- [ ] **Step 1: Failing test** (names from OQ-2's answer; option A shown):

```ts
it("defines the measure tokens of the closed scales (style guide §1, §2; OQ-2)", () => {
  const root = css.slice(0, css.indexOf("prefers-color-scheme: dark"));
  for (const [name, v] of [["h-counter", 18], ["h-tag", 24], ["h-compact", 30], ["h-normal", 40], ["h-row", 52], ["h-tile", 104],
    ["r-compact", 8], ["r-control", 12], ["r-card", 14], ["r-dialog", 18],
    ["s-1", 4], ["s-2", 8], ["s-3", 12], ["s-4", 16], ["s-5", 24], ["s-6", 32]] as const)
    expect(root).toMatch(new RegExp(`--hh-${name}:\\s*${v}px`));
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3:** add the tokens; set `--hh-control-h: var(--hh-h-normal)` and `--hh-control-r: var(--hh-r-control)`, and the top-bar override to the compact ones (keep the existing `control size tokens` test green). **Step 4: Run** — PASS. **Step 5: Commit** `feat(ui): measure tokens (style guide §1, §2)`.

**Gate:** `corepack pnpm exec vitest run packages/ui/test/styles.test.ts`

### Task 6: Plugin panel tokens mirror the app

**Files:**
- Modify: `packages/ui/src/plugin-ui/tokens.css` (all four blocks), `packages/ui/src/plugin-ui/plugin-ui.css:28-41` (`--hh-ok`, `--hh-warn`, `--hh-error-bg`)
- Modify: `harnesses/demo/plugins/on-this-day/panels/events.css:4` (`--hh-highlight` → `--hh-active`)
- Test: `packages/ui/test/plugin-ui-tokens.test.ts`

- [ ] **Step 1: Failing test:** the existing `every token under %s has the app's value` and `carries every colour the app has` tests already fail after Task 1. Add: `it("drops the removed tokens, keeping only the pre-refresh aliases (OQ-16)", …)` that asserts `panel` has no `--hh-callout-`, `--hh-review-`, `--hh-diff-`, `--hh-profile-`, `--hh-highlight`, `--hh-logo`. If OQ-16 says "keep one-release aliases for the removed tokens", assert those aliases point at the mapped tokens of Task 1 instead and add their names to `ALIASES`.
- [ ] **Step 2: Run** `corepack pnpm exec vitest run packages/ui/test/plugin-ui-tokens.test.ts` — FAIL.
- [ ] **Step 3: Implement:** copy the new token block (light, dark, `[data-theme]` ×2) from `styles.css`; add `--hh-mono` next to `--hh-font`; extend the `colours()` filter in the test to skip `--hh-mono` and the measure tokens. Replace `var(--hh-ok)`, `var(--hh-warn)`, `var(--hh-error-bg)` in `plugin-ui.css` as in Task 1. Rebuild the demo plugin's `dist` only if its build copies `events.css` (check `harnesses/demo/plugins/on-this-day/package.json`; H4).
- [ ] **Step 4: Run** — PASS. Also `corepack pnpm exec vitest run packages/ui/test/plugin-ui.test.tsx`.
- [ ] **Step 5: Commit** `feat(plugin-ui): tokens mirror the guide (style guide §2, §16.1)`.

**Gate:** the two runs above.

### Task 7: Harness CSS on the scale

**Files:**
- Modify: `harnesses/demo/ui/demo.css`, `packages/cli/template/ui/harness.css`
- Test: `harnesses/demo/test/` (add `demo-css.test.ts`) and `packages/cli/test/` (add a case to the template test if one exists; grep `harness.css` in `packages/cli/test`)

- [ ] **Step 1: Failing test** (`harnesses/demo/test/demo-css.test.ts`):

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
const css = readFileSync(join(import.meta.dirname, "../ui/demo.css"), "utf8");
it("uses only guide font sizes and weights (style guide §2, §15 harness blocks)", () => {
  for (const m of css.matchAll(/font-size:\s*(\d+)px/g)) expect([12, 13, 14, 15, 16, 20, 28]).toContain(Number(m[1]));
  for (const m of css.matchAll(/font-weight:\s*(\d+)/g)) expect([400, 500, 600]).toContain(Number(m[1]));
  expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
});
```

Same test for `packages/cli/template/ui/harness.css`.

- [ ] **Step 2: Run** `corepack pnpm exec vitest run harnesses/demo/test/demo-css.test.ts` — FAIL (11 px kicker, 11 px node span).
- [ ] **Step 3: Implement:** 11 px → 12 px in both files. Paddings, gaps, radii and the 24 px buttons stay for Part 15 (rows 25, 26) and are listed by Part 2's offenders.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `fix(demo): harness CSS on the type scale (style guide §2)`.

**Gate:** the run above.

### Part 1 close

- [ ] Part gate green; look check light and dark; manual check that colors of callouts, diffs, review marks, avatars and the logo read right. PR body: spec §2, rows 11, 31, 45, 46, 47, 48 (values), 54; the OQ answers used.

---

## Part 2 — Guard test (`feat/sg-guard`, from `feat/sg-tokens`)

**Area:** `packages/ui/test/style-guard-lib.ts` (new), `packages/ui/test/style-guard.test.ts` (new), `packages/ui/test/style-guard-offenders.json` (new, H4), `packages/ui/scripts/style-guard-init.ts` (new), `packages/ui/src/guide/classes.ts` (new).
**Hotspots:** H4 (the offenders file, which every later part shrinks).
**Spec:** §15 Control (automated test), §16.2. **Rows:** none directly; guards all.
**Blocked by:** OQ-2 (whether measure tokens exist changes what "on the scale" means for harness CSS).

### Task 8: The scanner

**Files:**
- Create: `packages/ui/test/style-guard-lib.ts`
- Test: `packages/ui/test/style-guard.test.ts` (unit cases on fixtures inside the test)

The scanner returns offenders as strings `"<file>|<kind>|<where>|<value>"`, where `kind` is one of `color`, `height`, `radius`, `space`, `font-size`, `weight`, `class`, `harness-color`, `harness-size`, and `where` is the CSS selector or the class name.

- [ ] **Step 1: Failing unit tests:**

```ts
import { describe, expect, it } from "vitest";
import { scanCss, scanTsx } from "./style-guard-lib";

describe("style guard scanner (style guide §15 Control)", () => {
  it("flags a loose color outside the token blocks, not inside them", () => {
    expect(scanCss("a.css", ":root { --hh-ink: #111111; }\n.x { color: #222222; }", { tokenFile: true })).toEqual(["a.css|color|.x|#222222"]);
  });
  it("flags off-scale heights, radii, spacing, font sizes and weights", () => {
    const out = scanCss("a.css", ".x { height: 36px; border-radius: 6px; gap: 10px; font-size: 11px; font-weight: 700; }", {});
    expect(out).toEqual(["a.css|height|.x|36px", "a.css|radius|.x|6px", "a.css|space|.x|10px", "a.css|font-size|.x|11px", "a.css|weight|.x|700"]);
  });
  it("allows the guide's values", () => {
    expect(scanCss("a.css", ".x { height: 30px; border-radius: 8px; padding: 0 16px 0 90px; gap: 12px; font-size: 13px; font-weight: 500; }", { topBarSelectors: [".x"] })).toEqual([]);
  });
  it("flags a className outside the guide's list", () => {
    expect(scanTsx("A.tsx", '<div className="hh-card hh-weird" />', new Set(["hh-card"]))).toEqual(["A.tsx|class|hh-weird|hh-weird"]);
  });
  it("flags a hex or rgb color in a TSX style", () => {
    expect(scanTsx("A.tsx", '<div style={{ color: "#fff" }} />', new Set())).toEqual(["A.tsx|color|style|#fff"]);
  });
});
```

- [ ] **Step 2: Run** `corepack pnpm exec vitest run packages/ui/test/style-guard.test.ts` — FAIL (module missing).
- [ ] **Step 3: Implement `style-guard-lib.ts`.** Allowed values, all from the spec:

```ts
// Style guide §2 (heights, radii, spacing, type, weights) and the fixed sizes named in §4–§10.
export const HEIGHTS = [18, 24, 30, 40, 52, 104];
/** Sizes the spec gives to specific pieces, allowed for height/width-like properties only: progress bar 6, dot 8,
 * icon 14 / 18 / 32, ring 16, toggle 20 × 34, avatar 32, logo 84, underline 2, border 1. */
export const PIECE_SIZES = [1, 2, 6, 8, 14, 16, 20, 32, 34, 84];
export const RADII = [8, 12, 14, 18]; // plus 4 only on inline code, plus round (999px or 50%) only on round pieces
export const SPACES = [0, 4, 8, 12, 16, 24, 32]; // plus 90 only as the top bar's left padding (§9)
export const FONT_SIZES = [12, 13, 14, 15, 16, 20, 28];
export const WEIGHTS = [400, 500, 600];
```

  - CSS parsing: strip comments; walk `selector { declarations }` blocks with nesting (`@media`, `@container`); for each declaration of `height|min-height|max-height` check `HEIGHTS ∪ PIECE_SIZES`; `border-radius` (each value of the shorthand) check `RADII`, `4px` only when the selector ends in `code`, `999px|50%` only when the selector is in `ROUND_SELECTORS` (filled by Part 6 with the round pieces: dot, avatar, toggle, counter, progress bar; empty at first, so today's 999px rules become offenders); `gap|row-gap|column-gap|padding*|margin*` check `SPACES` (negative values and `auto` pass); `font-size` px check `FONT_SIZES` (`em`, `%`, `calc(1em - 1px)` pass); `font-weight` check `WEIGHTS`; any `#hex|rgb(a)|hsl(a)` outside a block whose selector is `:root` (or `:root[data-theme=…]`) in a token file is a `color` offender.
  - `scanTsx`: read string literals and template-literal static parts of `className=`, plus `style={{…}}` objects for hex/rgb; every `hh-*` class must be in the passed set.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `test(ui): style guard scanner (style guide §15)`.

**Gate:** `corepack pnpm exec vitest run packages/ui/test/style-guard.test.ts`

### Task 9: The guide's class list

**Files:**
- Create: `packages/ui/src/guide/classes.ts`
- Test: `packages/ui/test/style-guard.test.ts`

- [ ] **Step 1: Failing test:** `import { GUIDE_CLASSES } from "../src/guide/classes"; it("every guide class has a rule in styles.css", () => { for (const c of GUIDE_CLASSES) expect(css, c).toMatch(new RegExp(`\\.${c}(?![\\w-])`)); });`
- [ ] **Step 2: Run** — FAIL (module missing).
- [ ] **Step 3: Implement:** `export const GUIDE_CLASSES: ReadonlySet<string> = new Set<string>([]);` with a comment: "The classes of the guide's pieces, templates and zones (style guide §1). A class enters only in the PR that adds its piece (§15). Parts 3–14 of the plan fill it." It starts empty on purpose: every `hh-*` class in use today is an offender until its piece lands.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `feat(ui): guide class list (style guide §15)`.

**Gate:** the run above.

### Task 10: Known offenders that may only shrink

**Files:**
- Create: `packages/ui/scripts/style-guard-init.ts`, `packages/ui/test/style-guard-offenders.json`
- Modify: `packages/ui/test/style-guard.test.ts`

- [ ] **Step 1: Failing test:**

```ts
import offenders from "./style-guard-offenders.json";
import { scanRepo } from "./style-guard-lib";

describe("the app stays inside the guide (style guide §15 Control, §16.2)", () => {
  const found = scanRepo(); // styles.css, plugin-ui/*.css, packages/ui/src/**/*.tsx, harness CSS (Task 11)
  it("no new offender: fix it, don't add it to the list", () => {
    const known = new Set(offenders as string[]);
    expect(found.filter((o) => !known.has(o))).toEqual([]);
  });
  it("the list only shrinks: remove an offender you fixed", () => {
    const now = new Set(found);
    expect((offenders as string[]).filter((o) => !now.has(o))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** — FAIL (file missing).
- [ ] **Step 3: Implement** `scanRepo()` in the lib (paths relative to the repo root, sorted output, duplicates kept once). `style-guard-init.ts` writes the JSON **only if the file does not exist** and exits 1 otherwise:

```ts
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scanRepo } from "../test/style-guard-lib";
const out = join(import.meta.dirname, "../test/style-guard-offenders.json");
if (existsSync(out)) { console.error("The offenders list exists: it may only shrink, by hand."); process.exit(1); }
writeFileSync(out, JSON.stringify(scanRepo(), null, 2) + "\n");
```

Run once: `corepack pnpm exec tsx packages/ui/scripts/style-guard-init.ts`. Commit the JSON. Write its line count in the PR body.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `test(ui): known style offenders, shrink only (style guide §16.2)`.

**Gate:** `corepack pnpm exec vitest run packages/ui/test/style-guard.test.ts`

### Task 11: Harness and plugin CSS are checked too

**Files:**
- Modify: `packages/ui/test/style-guard-lib.ts` (`scanRepo` adds `harnesses/*/ui/**/*.css`, `harnesses/*/plugins/*/panels/**/*.css`, `packages/cli/template/ui/**/*.css`, `packages/e2e/fixtures/plugins/*/panels/**/*.css` if present; `dist/` excluded)
- Modify: `packages/ui/test/style-guard-offenders.json` (the only time lines are added: the new files' offenders, in this same commit)

- [ ] **Step 1: Failing unit case** in `style-guard.test.ts`: `scanCss("h.css", ".b { color: var(--hh-ink); background: var(--other); padding: 7px; }", { harness: true })` returns `["h.css|harness-color|.b|var(--other)", "h.css|harness-size|.b|7px"]` — a harness file may use only `--hh-*` tokens for color and only scale values (or, with OQ-2 = A, measure tokens) for sizes (§15 Harness chat blocks).
- [ ] **Step 2: Run** — FAIL. **Step 3:** implement the `harness` mode; extend `scanRepo`; append the new files' offenders to the JSON (sorted). **Step 4: Run** — PASS. **Step 5: Commit** `test(ui): guard harness and plugin CSS (style guide §15)`.

**Gate:** `corepack pnpm exec vitest run packages/ui/test/style-guard.test.ts` and the part gate.

### Part 2 close

- [ ] Part gate green. PR body: the offenders count by kind (`jq` on the JSON), so later parts can show it shrinking.

---

## How the piece tasks (Parts 3–7) work

Every piece task has the same shape, so each task below only lists what differs:

1. **Failing test** in `packages/ui/test/guide-<piece>.test.tsx`: renders the piece with Testing Library and asserts its role, its accessible name, its states and the class/`data-*` attributes the CSS keys on; plus a CSS assertion in the same file that reads `styles.css` and checks the measures the spec gives (height, radius, type, weight). The measure assertions use the helper below (add it in Task 12, in `packages/ui/test/guide-css.ts`):

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
export const css = readFileSync(resolve(import.meta.dirname, "../src/styles.css"), "utf8");
/** The declarations of the first top-level rule whose selector list contains `sel` exactly. */
export function rule(sel: string): Record<string, string> {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`^[^{}]*(?:^|,\\s*)${esc}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, "m"));
  if (!m) throw new Error(`no rule for ${sel}`);
  return Object.fromEntries(m[1].split(";").map((d) => d.split(":").map((x) => x.trim())).filter(([k, v]) => k && v));
}
```

2. **Run it** with `corepack pnpm exec vitest run packages/ui/test/guide-<piece>.test.tsx` — expect FAIL (module missing).
3. **Implement** the component in `packages/ui/src/guide/<Piece>.tsx`, export it from `packages/ui/src/guide/index.ts`, write its CSS as one block in `styles.css` under a `/* guide: <Piece> */` comment, add its classes to `GUIDE_CLASSES`.
4. **Migrate** the "today" usages the task lists to the new piece; delete the old rules from `styles.css`; remove the offenders that disappear from `style-guard-offenders.json`; update the existing tests of the migrated components (named in the task) to query the new roles/names.
5. **Run** the new test, the updated tests and `style-guard.test.ts` — PASS.
6. **Commit** `feat(ui): <Piece> (style guide §<n>, rows <r>)`.

**Gate for every piece task:** `corepack pnpm exec vitest run packages/ui/test/guide-<piece>.test.tsx packages/ui/test/style-guard.test.ts <updated tests>`.

---

## Part 3 — Icons (`feat/sg-icons`, from `feat/sg-guard`)

**Area:** `packages/ui/src/guide/icons.tsx` (new), `packages/ui/src/guide/index.ts` (new), `packages/ui/src/chrome.tsx` (icon functions move out), `packages/ui/src/ActivityList.tsx`, `packages/ui/src/assets/loader.gif` (deleted), `packages/ui/src/assets.d.ts`, `packages/ui/src/sidekick/mark.tsx`, `packages/ui/src/markdown.tsx`, `packages/ui/src/EngineTab.tsx`, `packages/ui/src/plugins/PluginDetail.tsx`, `packages/ui/src/InputForm.tsx`, `packages/ui/src/MaterialPanel.tsx`, `packages/ui/src/Drawer.tsx`, `packages/ui/src/sidekick/SidekickPanel.tsx`, `packages/ui/src/MermaidDiagram.tsx`, `packages/harness-sdk/src/sidekick.ts` (mark schema, OQ-8), tests.
**Hotspots:** H2, H9 (SDK `mark` field, `index.ts` exports).
**Spec:** §4 (all). **Rows:** 12, 13, 14, 15, 26, 44 (mark is a set icon).
**Blocked by:** OQ-7 (glyph source), OQ-8 (existing marks), OQ-10 (key-value remove), OQ-19 ("›" in sentences).

### Task 12: One icon set with the closed names

**Files:**
- Create: `packages/ui/src/guide/icons.tsx`, `packages/ui/src/guide/index.ts`, `packages/ui/test/guide-css.ts`
- Test: `packages/ui/test/guide-icons.test.tsx`

- [ ] **Step 1: Failing test:**

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ICON_NAMES, Icon } from "../src/guide/icons";

describe("icon set (style guide §4)", () => {
  it("has exactly the closed names", () => {
    expect([...ICON_NAMES].sort()).toEqual([
      "add", "attention", "back", "bell", "callout-decision", "callout-note", "callout-question", "callout-summary", "callout-tip", "callout-warning",
      "check", "chevron", "close", "coach", "daily-summary", "engine", "files", "focus", "fullscreen", "guardian", "history", "home", "inbox",
      "info", "jobs", "loading", "lock", "mentor", "more", "next", "note", "plugins", "search", "settings", "tasks", "text", "undo",
    ].sort());
  });
  it.each([14, 18, 32] as const)("draws a 24 box, 1.75 stroke, round caps, currentColor, no fill at %i", (size) => {
    const { container } = render(<Icon name="check" size={size} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("width")).toBe(String(size));
    expect(svg.getAttribute("stroke-width")).toBe("1.75");
    expect(svg.getAttribute("stroke-linecap")).toBe("round");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  });
  it("the loading icon is static under reduced motion", async () => {
    const { css, rule } = await import("./guide-css");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{[^}]*\.hh-icon-loading\s*{[^}]*animation:\s*none/);
    expect(rule(".hh-icon-loading").animation).toBeDefined();
  });
});
```

The names map one to one to spec §4: Inicio `home`, Tareas `tasks`, Bandeja `inbox`, Jobs `jobs`, Archivos `files`, Plugins `plugins`, Nota `note`, Settings `settings`, Avisos `bell`, Buscar `search`, Cerrar `close`, Volver `back`, Seguir `next`, Agregar `add`, Historial `history`, Deshacer `undo`, Desplegar `chevron`, Más `more`, Listo `check`, Atención `attention`, Info `info`, Solo lectura `lock`, Pantalla completa `fullscreen`, Texto `text`, Motor `engine`, Cargando `loading`, the six callout icons `callout-*`, the five sidekick icons Coach `coach`, Foco `focus`, Guardián `guardian`, Mentor `mentor`, Resumen del día `daily-summary`.

- [ ] **Step 2: Run** `corepack pnpm exec vitest run packages/ui/test/guide-icons.test.tsx` — FAIL.
- [ ] **Step 3: Implement** `Icon({ name, size }: { name: IconName; size: 14 | 18 | 32 })` with one `<path>`/`<circle>` list per name. Glyphs per OQ-7. The chevron points right and the CSS rotates it 90° when `aria-expanded="true"` on its button (§4 Desplegar). `loading` spins with a CSS animation, `animation: none` under reduced motion.
- [ ] **Step 4–6** as in the shape; commit `feat(ui): one icon set with the closed names (style guide §4)`.

### Task 13: Old icons and the GIF go

**Files:**
- Modify: `packages/ui/src/chrome.tsx:147-316` (delete `GearIcon`, `EngineIcon`, `SaveIcon`, `CheckIcon`, `LockIcon`, `NoteIcon`, `CloseIcon`, `ChevronIcon`, `UndoIcon`, `ClockIcon`, `WarnIcon`, `BellIcon`, `InboxIcon`; the rail icons), every importer (grep each name in `packages/ui/src` and `harnesses/demo/ui`)
- Modify: `packages/ui/src/ActivityList.tsx` (GIF → `<Icon name="loading" size={14} />`), delete `packages/ui/src/assets/loader.gif`, drop its declaration in `assets.d.ts` if unused
- Test: `packages/ui/test/guide-icons.test.tsx`, `packages/ui/test/working.test.tsx`, `packages/ui/test/chrome.test.tsx`

- [ ] **Step 1: Failing test** (add to `guide-icons.test.tsx`):

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const SRC = join(import.meta.dirname, "../src");
const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : [join(d, f)]));
it("no <svg> outside the icon set, the logos and the sidekick mark; no GIF (style guide §4, rows 13, 14)", () => {
  const allowed = ["guide/icons.tsx", "chrome.tsx" /* HHLogo only */, "MermaidDiagram.tsx" /* the diagram's own drawing */];
  for (const f of files(SRC).filter((x) => x.endsWith(".tsx"))) {
    const text = readFileSync(f, "utf8");
    if (allowed.some((a) => f.endsWith(a))) continue;
    expect(text, f).not.toMatch(/<svg[\s>]/);
  }
  expect(files(SRC).filter((f) => f.endsWith(".gif"))).toEqual([]);
  expect(readFileSync(join(SRC, "chrome.tsx"), "utf8").match(/<svg[\s>]/g)?.length).toBe(1); // HHLogo
});
```

- [ ] **Step 2–6** per the shape. Map: `GearIcon`→`settings`, `EngineIcon`→`engine`, `SaveIcon`→ deleted (Settings saves itself; the button goes in Part 8, row 74 — until then the Settings exit uses `back`), `CheckIcon`→`check`, `LockIcon`→`lock`, `NoteIcon`→`note`, `CloseIcon`→`close`, `ChevronIcon`→`chevron`, `UndoIcon`→`undo`, `WarnIcon`→`attention`, `BellIcon`→`bell`, `InboxIcon`→`inbox`. `ClockIcon` has no name in §4: list its uses in the PR under "Questions for Marco" and leave it as an offender (see OQ-7). Update `working.test.tsx` to expect the loading icon instead of the GIF `img`.

### Task 14: Characters used as icons go

**Files:**
- Modify: `packages/ui/src/EngineTab.tsx` (✓), `packages/ui/src/plugins/PluginDetail.tsx` (←), `packages/ui/src/InputForm.tsx` and `packages/ui/src/MaterialPanel.tsx` (×), `packages/ui/src/Drawer.tsx` (✕), `packages/ui/src/sidekick/SidekickPanel.tsx` (› collapse), `packages/ui/src/markdown.tsx` (↩ footnote back-link)
- Modify: `packages/i18n/src/locales/en.json` (footnote "volver" text, OQ-1)
- Test: `packages/ui/test/guide-icons.test.tsx`, `packages/ui/test/markdown.test.tsx`, `packages/ui/test/engine-tab.test.tsx`, `packages/ui/test/input-form.test.tsx`, `packages/ui/test/material-panel.test.tsx`, `packages/ui/test/drawer.test.tsx`, `packages/ui/test/sidekick-panel.test.tsx`, `packages/ui/test/plugins-tab.test.tsx`

- [ ] **Step 1: Failing test:** for each `.tsx` under `src`, no JSX text node or string literal rendered as content is exactly one of `✓ ← × ✕ › ↩` (regex `/>\s*[✓←×✕›↩]\s*</` and `/["'][✓←×✕›↩]["']/`). `›` inside sentences of `en.json` (e.g. "Settings › Usage") is not checked here; see OQ-19. Markdown test: a footnote back-link renders the text from OQ-1, not `↩`.
- [ ] **Step 2–6** per the shape: ✓ → `check` 14 (engine tile until Part 14 replaces it with options), ← → `back` 18 in a quiet button, × (remove row / remove material) → per OQ-10 (the key-value remove) and `close` 14 for material until Part 12, ✕ → `close` 18, › → `chevron` 18, ↩ → text. Row 12.

### Task 15: Callout icons, sidekick marks, the demo's arrows

**Files:**
- Modify: `packages/ui/src/markdown.tsx` (callout head gets `<Icon name="callout-<type>" size={14} />`)
- Modify: `packages/ui/src/sidekick/mark.tsx` (24 circle with a 14 set icon; no emoji, no token dot)
- Modify: `packages/harness-sdk/src/sidekick.ts:62,177,264` (`mark` becomes one of the icon names; `DEFAULT_SIDEKICK.mark` per OQ-8), `packages/ui/src/sidekick/*` callers
- Read only: `harnesses/demo/ui/DiagramBlock.tsx` (its arrows stay as the block's drawing, row 26)
- Test: `packages/ui/test/markdown.test.tsx`, `packages/ui/test/sidekick-panel.test.tsx`, `packages/harness-sdk/test/sidekick*.test.ts`, `packages/ui/test/guide-icons.test.tsx`

- [ ] **Step 1: Failing tests:**
  - markdown: `> [!tip] x` renders an `svg` inside `.hh-callout-head` with the `callout-tip` icon; same for note, warning, summary, decision, question (row 15).
  - mark: `render(<SidekickMark icon="coach" />)` draws `span.hh-sk-mark` (24 round) containing a 14 `svg`; `SidekickMark` no longer accepts an emoji or a `--hh-*` string (TS error test via `// @ts-expect-error`) (row 44).
  - SDK: the sidekick schema rejects `mark: "🦊"` and accepts each icon name of §4 ("A custom sidekick picks one of these or any set icon").
  - guard: `DiagramBlock.tsx` keeps its own `<svg>`; add `harnesses/demo/ui/DiagramBlock.tsx` to the allowed list of Task 13's test with the comment "row 26: the block's drawing, not an icon".
- [ ] **Step 2–6** per the shape. Stored marks that are no longer valid follow OQ-8.

### Part 3 close

- [ ] Part gate green; look check; offenders shrank. PR body: rows 12, 13, 14, 15, 26, 44.

---

## Part 4 — Buttons and ways to choose (`feat/sg-buttons`, from `feat/sg-icons`)

**Area:** `packages/ui/src/guide/{Button,IconButton,Segmented,Tabs,NavItem,Option,Tile,Toggle,Checkbox}.tsx` (new), `packages/ui/src/chrome.tsx` (`Segmented`, `SidekickToggle` move/redo), and the files that use the §3 "today" classes: `TaskHeader.tsx`, `Home.tsx`, `FlowSide.tsx`, `ModelsTab.tsx`, `NotesPanel.tsx`, `DocumentReader.tsx`, `parallel/InboxBoard.tsx`, `parallel/Inbox.tsx`, `parallel/JobsTab.tsx`, `parallel/TaskStrip.tsx`, `sidekick/SidekickPanel.tsx`, `HistoryPanel.tsx`, `InputForm.tsx`, `ContextPanel.tsx`, `FileTimeline.tsx`, `HarnessSettingsTab.tsx`, `RecommendModeBlock.tsx`, `hatches/EngineConfig.tsx`, `hatches/EngineNotice.tsx`, `hatches/LinkedFolders.tsx`, `sidekick/{PresetOffer,SidekickList,LearnedList,SidekickTab,ImportSidekick}.tsx`, `plugins/{PluginDetail,PluginsTab,PluginsSection}.tsx`, `SettingsPage.tsx`, `UsageTab.tsx`, `ChoicesBlock.tsx`, `ChatView.tsx`, `ModeList.tsx`, `FolderStep.tsx`, `LanguagePicker.tsx`, `EngineTab.tsx`, `StartView.tsx`, and their tests.
**Hotspots:** H2, H10, H6 (only labels that change).
**Spec:** §3 (all), §5 Toggle / Checkbox / Radio and the choosing rule. **Rows:** 9, 10, 20, 21, 22, 23, 56, 80.
**Blocked by:** OQ-1 (only for "Guardando…" busy text and any changed label), OQ-20 (check on the chosen tile).

### Task 16: Button (8 types, 2 sizes, 5 states) and IconButton

**Files:** Create `packages/ui/src/guide/Button.tsx`, `packages/ui/src/guide/IconButton.tsx`. Test `packages/ui/test/guide-button.test.tsx`.

- [ ] **Step 1: Failing test** asserts:
  - `<Button kind="primary|secondary|quiet|danger|link|large">` renders a `button` (or `a` for `href`, row: `a.hh-button` → secondary that opens outside) with `data-kind` and `data-size="normal|compact"`; `icon` prop draws the icon left of the text; `busy` sets `aria-busy="true"`, shows the loading icon and the busy text, and disables it; `disabled` disables it.
  - `large` has no compact size and always draws `next` after the text when `arrow` is set (rows 20, 83).
  - CSS: `rule(".hh-btn[data-size=\"normal\"]")` height `40px` radius `12px`; compact height `30px` radius `8px` font-size `13px` weight `500`; large height `52px` radius `14px`; primary background `var(--hh-cta)` color `var(--hh-cta-ink)` hover `var(--hh-cta-hover)`; quiet has no border and no fill; link only underlined text.
  - `<IconButton icon="search" label="…" />` is square (width = height), has `aria-label` and `title` equal to the label (tooltip, §3 Icon), icon 18.
- [ ] **Steps 2–6** per the shape. Migrate: `.hh-cta`, `.hh-primary` → primary; `.hh-pill` used as an action (Historial, Restaurar, engine on Inicio as a button) → compact secondary (row 9); `.hh-link` used as an action (Ver todo, Editar, plugin Back, Saltar) → quiet (rows 80); `.hh-tk-cancel` → quiet compact; `a.hh-button` (Soporte, Ver planes in `SettingsPage.tsx`, `UsageTab.tsx`) → secondary `href`; `.hh-icon-button` and `.hh-topbar-icon` → `IconButton`. `.hh-pill` that shows a state (context meter, Sidekick) waits for Chip (Part 6) and the top bar (Part 8). Update `chat-look.test.tsx`, `task-header.test.tsx`, `models-tab.test.tsx`, `jobs-ui.test.tsx`, `inbox.test.tsx`, `settings.test.tsx`, `usage-tab.test.tsx`, `styles.test.ts` (`draws the CTA's focus ring` and `soft-cards controls` now name `.hh-btn[data-kind="primary"]`).

### Task 17: Segmented (30, radius 8) replaces button groups

**Files:** Create `packages/ui/src/guide/Segmented.tsx` (moves `Segmented` out of `chrome.tsx:99-123`, keeps its API). Modify `SettingsPage.tsx` (`.hh-text-sizes`, row 77), `plugins/PluginDetail.tsx` (`.hh-pl-days`), `StartView.tsx` (Tarjetas / Lista). Test `packages/ui/test/guide-segmented.test.tsx`, `settings.test.tsx`, `plugins-tab.test.tsx`, `start-view.test.tsx`.

- [ ] **Step 1: Failing test:** `role="group"` with buttons `aria-pressed`; 2–4 options only (a dev-time `console.error` for more, asserted with a spy); CSS height `30px`, radius `8px`, chosen segment background `var(--hh-active)` color `var(--hh-active-ink)` (§2 active, row 22). Text sizes and weekdays render as `Segmented` (§3 "also replaces button groups").
- [ ] **Steps 2–6** per the shape. Rows 22, 77 (control part).

### Task 18: Tabs (40) with waiting dot

**Files:** Create `packages/ui/src/guide/Tabs.tsx`. Modify `parallel/TaskStrip.tsx` (`.hh-tk-tab` 44), `plugins/PluginsSection.tsx` (`.hh-pl-tab` 24). Test `packages/ui/test/guide-tabs.test.tsx`, `parallel-chat.test.tsx`, `plugin-slots.test.tsx`.

- [ ] **Step 1: Failing test:** `role="tablist"` / `tab` with `aria-selected`; arrow keys move; a tab with `waiting` shows an orange dot (`Dot` lands in Part 6: until then a `span.hh-tab-dot` with `data-tone="waiting"`, replaced in Task 26); CSS height `40px`. Row 23.
- [ ] **Steps 2–6** per the shape.

### Task 19: NavItem (40)

**Files:** Create `packages/ui/src/guide/NavItem.tsx`. Modify `SettingsPage.tsx` (`.hh-settings-navitem`), `SetupStepsList.tsx` (assistant steps), `FlowSide.tsx` (`.hh-flow-step` 44). Test `packages/ui/test/guide-nav-item.test.tsx`, `settings.test.tsx`, `setup-flow.test.tsx`, `flow-parts.test.tsx`.

- [ ] **Step 1: Failing test:** a `button` with `aria-current="page"` (Settings) or `"step"` (Assistant, walkthrough) when selected; optional `lead` slot (step mark) and `trail` slot (counter or 12 px value); CSS height `40px`, radius `12px`, selected fill per the artifact (rule 1). §3 Nav item.
- [ ] **Steps 2–6** per the shape.

### Task 20: Option (52) and Tile (104)

**Files:** Create `packages/ui/src/guide/Option.tsx`, `packages/ui/src/guide/Tile.tsx`. Modify `ChoicesBlock.tsx`, `ChatView.tsx` (the `.hh-choice` uses), `RecommendModeBlock.tsx`, `ModeList.tsx`, `FolderStep.tsx` (`.hh-place`), `LanguagePicker.tsx` (`.hh-langpick-option`), `EngineTab.tsx` (`.hh-engine-radio`, `.hh-tile` → Option, rows 21, 76), `StartView.tsx` (`.hh-topic` → Tile). Test `packages/ui/test/guide-option.test.tsx`, `choices.test.tsx`, `recommend-mode.test.tsx`, `modes.test.tsx`, `folder-step.test.tsx`, `language-picker.test.tsx`, `engine-tab.test.tsx`, `start-view.test.tsx`.

- [ ] **Step 1: Failing test:**
  - Option: a `radiogroup` of `radio` items, each 52 high with a visible 18 radio, title and description; `recommended` draws the amber border (`border-color: var(--hh-cta)`); optional `tag` slot (chat options' type tag, Part 9). Radio never appears outside an Option (§5 Radio): the guard's class list has no loose radio class.
  - Tile: 104 high, radius 14, logo or description; selected = `border: 2px solid var(--hh-ink)`, no check (§3; see OQ-20 for the §4 contradiction).
  - The engine renders as Options, not tiles (row 21; Settings and Assistant layout in Parts 13–14).
- [ ] **Steps 2–6** per the shape.

### Task 21: Toggle (one form), Checkbox (accept only), Radio (inside Option)

**Files:** Create `packages/ui/src/guide/Toggle.tsx`, `packages/ui/src/guide/Checkbox.tsx`. Modify every toggle today: grep `role="switch"`, `type="checkbox"` in `packages/ui/src` (plugins toggle in `PluginsTab.tsx`, notices, Sidekick in `SidekickTab.tsx`, `HarnessSettingsTab.tsx`, `InputForm.tsx` multi-choice). Test `packages/ui/test/guide-toggle.test.tsx`, `plugins-tab.test.tsx`, `sidekick-tab.test.tsx`, `harness-settings.test.tsx`, `input-form.test.tsx`.

- [ ] **Step 1: Failing test:**
  - Toggle: `role="switch"` with `aria-checked`; CSS `width: 34px; height: 20px`, round.
  - Checkbox: 18, field style, used only with a `purpose="accept"` prop (TS-required) — the type forbids any other use.
  - A "several from a list" field (`multiChoice` in `InputForm`) renders one Toggle per row, no checkboxes (rows 10, 56).
  - A source scan: no `type="checkbox"` outside `guide/Checkbox.tsx`; no `role="switch"` outside `guide/Toggle.tsx`.
- [ ] **Steps 2–6** per the shape. Rows 10, 56.

### Part 4 close

- [ ] Part gate green (`e2e` specs that click renamed buttons updated: grep `getByRole("button"` names changed by OQ-1); look check; offenders shrank. PR body: §3, rows 9, 10, 20, 21, 22, 23, 56, 80.

---

## Part 5 — Forms (`feat/sg-forms`, from `feat/sg-buttons`)

**Area:** `packages/ui/src/guide/{Field,FormField,SettingsRow}.tsx` and `packages/ui/src/guide/fields/*.tsx` (new), `packages/ui/src/InputForm.tsx`, `packages/ui/src/InputBlock.tsx`, `packages/ui/src/settings-parts.tsx` (`SettingRow`), `packages/ui/src/HarnessSettingsTab.tsx`, `packages/ui/src/SetupStepForm.tsx`, `packages/ui/src/connections/SecretField.tsx`, `packages/ui/src/connections/ConnectionsTab.tsx`, `packages/ui/src/ModelsTab.tsx`, `packages/harness-sdk/src/block.ts` and `settings.ts` (only per OQ-9), tests.
**Hotspots:** H2, H6, H9 (OQ-9).
**Spec:** §5 (all). **Rows:** 24, 50, 51, 52, 53, 55.
**Blocked by:** OQ-1, OQ-9, OQ-10.

### Task 22: Field, select, textarea and the native inputs share the field style

**Files:** Create `packages/ui/src/guide/Field.tsx` (`TextField`, `NumberField` with min/max and grey unit, `TextArea` ≥ 3 lines, `Select`, `PasswordField`, `TimeField`). Modify `styles.css` (one field block; remove browser-styled number/password/time/textarea). Test `packages/ui/test/guide-field.test.tsx`, `input-form.test.tsx`.

- [ ] **Step 1: Failing test:** each renders the native control inside `.hh-field` with `data-size="normal|compact"`; CSS: `.hh-field input, .hh-field select` height `var(--hh-control-h)` (40, 30 compact), radius `var(--hh-control-r)`, background `var(--hh-surface)`, border `1px solid var(--hh-line)`; textarea `rows >= 3`; number shows its unit after the input in `var(--hh-muted)`. Row 24.
- [ ] **Steps 2–6** per the shape.

### Task 23: Form with the label on top

**Files:** Create `packages/ui/src/guide/FormField.tsx`. Modify `InputForm.tsx`, `SetupStepForm.tsx`, `sidekick/SidekickEditor.tsx` (editor). Test `packages/ui/test/guide-form-field.test.tsx`, `input-form.test.tsx`, `setup-flow.test.tsx`, `sidekick-list.test.tsx`.

- [ ] **Step 1: Failing test:** label 14/600 above the field with 8 gap; `required` adds a red asterisk (`color: var(--hh-t-red-ink)`), optional has no mark; `help` is one 13 grey line under the field; `error` is 13 red with the `attention` icon under its field, sets `aria-invalid` and the field border to `var(--hh-t-red-ink)`; fields stack with 24 between; field width `100%` up to `var(--hh-read-w)`. No error list above the form (assert the old summary `role="alert"` is gone from `InputForm`). Row 50.
- [ ] **Steps 2–6** per the shape.

### Task 24: The 12 field types

**Files:** Create `packages/ui/src/guide/fields/{OneOf,SeveralOf,YesNo,Secret,Path,Pairs,Slider,DateField,ColorField}.tsx`. Modify `InputForm.tsx` (drawing by kind), `connections/SecretField.tsx` (row 53), `HarnessSettingsTab.tsx` (setting controls). SDK changes only per OQ-9. Test `packages/ui/test/guide-fields.test.tsx`, `input-form.test.tsx`, `connections-ui.test.tsx`, `harness-settings.test.tsx`, `input-parity.test.ts`.

- [ ] **Step 1: Failing test** for each type of §5:
  - One of several: 2–4 short values → Segmented; with descriptions → Options; more than 6 → Select (the choosing rule; 5–6 values without descriptions: see OQ-9b). Never loose radios.
  - Several from a list: Toggles, one per compact row.
  - Yes / no: Toggle (settings) or Checkbox (accept before going on).
  - Secret: hidden field + one button `Guardar` when empty / `Reemplazar` when set + More (⋯) menu with `Borrar` (confirmed, Part 7 InlineConfirm) and `Probar` (row 53). The menu piece lands in Part 7: this task renders a `More` IconButton and a temporary list; Task 32 swaps in `Menu`.
  - Folder or file: path as inline code + `Elegir…`.
  - Key-value pairs: rows of two fields with remove (icon per OQ-10) and a borderless `Agregar` at the end.
  - Slider: full width, `min`, `max`, `step` required props.
  - Date: field with the calendar picker (native `type="date"` styled as a field; if the artifact shows another picker, rule 1).
  - Color: swatch + code + `Cambiar`.
  - Text, Number, Textarea: from Task 22.
  - A harness field of an unknown kind does not render a free control: `InputForm` shows nothing and logs (row 51).
- [ ] **Steps 2–6** per the shape. Rows 51, 53.

### Task 25: Settings row (52) and read-only rows

**Files:** Create `packages/ui/src/guide/SettingsRow.tsx` (replaces `SettingRow` in `settings-parts.tsx:57`). Modify `ModelsTab.tsx` (Restaurar → "Recomendado: …", row 55), every loose "label : value" row (grep `hh-kv`, `hh-row-value`, `<dl` in `packages/ui/src`; row 52). Test `packages/ui/test/guide-settings-row.test.tsx`, `settings-parts.test.tsx`, `models-tab.test.tsx`.

- [ ] **Step 1: Failing test:** row 52 high; label 14 + help 13 on the left, compact control on the right; a field error is a red status line under the label; with `value` and no control, the value is a grey tag on the right (row 52); with `recommended` different from `value`, a 12 grey "Recomendado: …" line under the control and no tag, no Restaurar; nothing when they match (row 55).
- [ ] **Steps 2–6** per the shape.

### Part 5 close

- [ ] Part gate green; look check of Settings › Modelos, Conexiones, the demo's input blocks and the Assistant form; offenders shrank. PR body: §5, rows 24, 50, 51, 52, 53, 55.

---

## Part 6 — Indicators and card (`feat/sg-indicators`, from `feat/sg-forms`)

**Area:** `packages/ui/src/guide/{Tag,Chip,Counter,Dot,StepMark,ProgressBar,Ring,Avatar,Table,Card}.tsx` (new), `packages/ui/src/chrome.tsx` (`Tag`, `MockBadge`), `packages/ui/src/RecommendModeBlock.tsx` (`.hh-badge`), `packages/ui/src/SetupStepsList.tsx`, `packages/ui/src/Home.tsx` (missing steps), `packages/ui/src/FlowSide.tsx`, `packages/ui/src/settings-parts.tsx` (`SettingsCard`), `packages/ui/src/connections/ConnectionsTab.tsx` (letter), `packages/ui/src/ProfileSwitcher.tsx`, `packages/ui/src/ProfilesSection.tsx`, `packages/ui/src/plugins/AttentionInbox.tsx` (`.hh-pl-badge`), `packages/ui/src/plugins/PluginChips.tsx`, `packages/ui/src/DocumentCards.tsx`, `packages/ui/src/FlowSide.tsx` (`ContextMeter`), `packages/ui/src/UsageMeter.tsx`, `packages/ui/src/markdown.tsx` (table), `packages/ui/src/UsageTab.tsx`, `packages/ui/test/style-guard-lib.ts` (`ROUND_SELECTORS`), tests.
**Hotspots:** H2, H6 ("prueba").
**Spec:** §6 (all, with Card). **Rows:** 18, 19, 27, 30, 49, 54.
**Blocked by:** OQ-1 (strings only).

### Task 26: Tag (24, 600) with fixed meanings; mock badge → grey "prueba"

**Files:** Create `packages/ui/src/guide/Tag.tsx` (from `chrome.tsx:136-145`). Modify `chrome.tsx` (`MockBadge` → `Tag tone="gray"` with the OQ-1 text, row 30), `RecommendModeBlock.tsx` (`.hh-badge`, defined twice in CSS — delete both), every "Actualizado", "Lista", "Pendiente" loose badge (grep those strings' keys in `en.json` and their components; row 18). Test `packages/ui/test/guide-tag.test.tsx`, `chrome.test.tsx`, `recommend-mode.test.tsx`, `mock.spec.ts` (e2e).

- [ ] **Step 1: Failing test:** `Tag tone` in `green|orange|blue|violet|red|gray`; CSS height `24px`, radius `8px`, weight `600` (row 54); gray = `surface-2` + `ink` (spec §2 grey; today's test says `muted` — update it); a model-level helper `levelTone("light"|"standard"|"deep")` returns green/blue/violet (§6). Source scan: no `hh-badge`, no `hh-mock-badge` class left.
- [ ] **Steps 2–6** per the shape.

### Task 27: Chip (30), Counter (18), Dot (8)

**Files:** Create `packages/ui/src/guide/{Chip,Counter,Dot}.tsx`. Modify the state `.hh-pill`s (context meter in `FlowSide.tsx`/`UsageMeter.tsx`, engine chip on `Home.tsx`), plugin chips (`plugins/PluginChips.tsx`, 24/11 px), reader and review chips (`DocumentCards.tsx`, `DocumentReader.tsx`), FAQ chips (`StartView.tsx`), `.hh-pl-badge` (`AttentionInbox.tsx`) → Counter, the Bandeja pill counter (moves in Part 8), the `.hh-dot` uses → Dot; `Tabs` waiting dot → `Dot`. Test `packages/ui/test/guide-chip.test.tsx`, `document-cards.test.tsx`, `attention-inbox.test.tsx`, `start-view.test.tsx`, `home-look.test.tsx`.

- [ ] **Step 1: Failing test:** Chip is `surface` with `line` border, 30 high, radius 8, weight 500; a `button` only when `onClick` is set (opens what it names or sends a FAQ), else a `span`; Counter 18 round; Dot 8 round with `data-state="ready|waiting|off|error"` colored green/orange/grey/red ink. Add `.hh-dot`, `.hh-counter` (and later `.hh-avatar`, `.hh-toggle`, `.hh-progress`) to `ROUND_SELECTORS` in the guard. Row 9 (state pills).
- [ ] **Steps 2–6** per the shape.

### Task 28: StepMark (24, r 8), ProgressBar (6), Ring (16), Avatar (24 · 32), Table (rows 40)

**Files:** Create the five components. Modify: step marks in `SetupStepsList.tsx` (18), `Home.tsx` missing steps (26), `FlowSide.tsx` walkthrough (26 square), the Assistant end's 48 circle (`SetupFlow.tsx`; becomes an empty state with check 32 in Part 13, row 19); progress bars in `UsageMeter.tsx`, `parallel/InboxBoard.tsx`, `sidekick/SidekickPanel.tsx`; the context ring in the context chip; avatar in `ProfileSwitcher.tsx`, `ProfilesSection.tsx`, and the Conexiones letter in `connections/ConnectionsTab.tsx` (32 square → Avatar 32, row 27); tables in `markdown.tsx` and `UsageTab.tsx`. Test `packages/ui/test/guide-indicators.test.tsx`, `setup-flow.test.tsx`, `home.test.tsx`, `flow-parts.test.tsx`, `usage-tab.test.tsx`, `connections-ui.test.tsx`, `profiles-settings.test.tsx`, `markdown.test.tsx`.

- [ ] **Step 1: Failing test:** StepMark 24 / radius 8 with `state="done|current|next"` (done shows `check` 14); ProgressBar 6 round, `near` switches to orange (§6); Ring 16 used only inside the context chip (source scan: `Ring` imported only by the context chip's file); Avatar 24 or 32 round, initial letter, `data-color` from Task 2; Table rows 40, header 12 grey. Rows 19, 27.
- [ ] **Steps 2–6** per the shape.

### Task 29: Card (one card, never nested)

**Files:** Create `packages/ui/src/guide/Card.tsx`. Modify `settings-parts.tsx` (`SettingsCard`), `ModelsTab.tsx` (nested cards), every `.hh-card` use and rule (grep `hh-card` in `packages/ui/src`). Test `packages/ui/test/guide-card.test.tsx`, `settings-parts.test.tsx`, `models-tab.test.tsx`.

- [ ] **Step 1: Failing test:**

```tsx
render(<Card eyebrow="Paso 2" title="Motor" tag={<Tag tone="green">ok</Tag>} actions={[{ label: "Cancelar" }, { label: "Usar", primary: true }]}>body</Card>);
// order: eyebrow, header (title left, only a tag right), body, actions (right-aligned, primary rightmost, compact)
```

Asserts: `section.hh-card` radius 14, `surface`, `line` border; `data-pad="16|24"` (16 in lists, columns, chat; 24 in Settings and the Assistant); 12 between parts; header right side accepts only a `Tag` element (TS type `tag?: ReactElement<typeof Tag>`); actions: at most 2 (one primary, one secondary), compact; a third action goes to a More (⋯) menu (wired to `Menu` in Task 32); rendering a `Card` inside a `Card` throws in dev (a context flag) — `models-tab.test.tsx` asserts Settings › Modelos has no nested card. Rows 49.
- [ ] **Steps 2–6** per the shape.

### Part 6 close

- [ ] Part gate green; look check; offenders shrank. PR body: §6, rows 18, 19 (marks), 27, 30, 49, 54.

---

## Part 7 — Messages and overlays (`feat/sg-messages`, from `feat/sg-indicators`)

**Area:** `packages/ui/src/guide/{StatusLine,Notice,InlineConfirm,EmptyState,Dialog,Popover,Menu,AnnotationTooltip}.tsx` (new); every file with `role="alert"` today (list in Task 30); `packages/ui/src/search/SearchPalette.tsx`, `packages/ui/src/search/SearchHost.tsx`, `packages/ui/src/search/model.ts`; `packages/ui/src/LanguagePicker.tsx`, `packages/ui/src/TranslateNotice.tsx`, `packages/ui/src/ProfileSwitcher.tsx`, `packages/ui/src/plugins/AttentionInbox.tsx`, `packages/ui/src/AnnotateBlock.tsx`, `packages/ui/src/FocusMarkers.tsx`; tests and `packages/e2e/tests/search*.spec.ts`.
**Hotspots:** H2, H6, H10.
**Spec:** §7, §8 (with Search). **Rows:** 16, 17, 29, 39, 40.
**Blocked by:** OQ-1.

### Task 30: StatusLine and Notice in four tones; no toasts

**Files:** Create `packages/ui/src/guide/StatusLine.tsx`, `packages/ui/src/guide/Notice.tsx`. Modify the ~10 error/notice styles and every unstyled `role="alert"`: `ScopePicker.tsx`, `EngineOnboarding.tsx`, `ProfilesSection.tsx`, `HistoryPanel.tsx`, `ContextPanel.tsx`, `InputForm.tsx`, `SettingsPage.tsx`, `LanguagePicker.tsx`, `ErrorCard.tsx`, `FolderStep.tsx`, `NotesPanel.tsx`, `ModelsTab.tsx`, `ChatView.tsx`, `SetupFlow.tsx`, `HarnessApp.tsx`, `HarnessSettingsTab.tsx`, `EngineTab.tsx`, `FileDiff.tsx`, `BackupNotice.tsx`, `DocumentReader.tsx`, `TranslateNotice.tsx`, `ProfileStep.tsx`, `hatches/BackendCard.tsx`, `ProfileSwitcher.tsx`, `hatches/EngineConfig.tsx`, `hatches/LinkedFolders.tsx`, `sidekick/{PresetOffer,LearnedList,SidekickTab,SidekickList,ScopeSidekicks,SidekickEditor,SidekickPanel,ImportSidekick}.tsx`, `parallel/{InboxBoard,Inbox,JobsTab}.tsx`, `plugins/{PermissionReview,PluginDetail,PreparedTask,PluginsTab,PanelFrame}.tsx`, `connections/{ConnectionsTab,ConnectStep}.tsx`. (`plugin-ui/components.tsx` waits for Part 15.) Test `packages/ui/test/guide-messages.test.tsx` plus each touched component's test.

- [ ] **Step 1: Failing test:**
  - `StatusLine tone="error|attention|info|ok"`: text color only (red, orange, grey, green ink), `attention` / `info` icon 14 at the start for those tones (§4); `role="status"` (or `alert` for error).
  - `Notice tone=…`: colored background (tag fill; info = `surface-2`), title + text, up to two compact buttons: `secondary` with border and transparent fill in the notice's ink, or one `primary`; passing a `quiet` button is a TS error (`// @ts-expect-error`).
  - Source scan: outside `guide/`, no `role="alert"` element that is not rendered by `StatusLine`/`Notice` (regex on `role="alert"` in `packages/ui/src/**/*.tsx` except `guide/` and `plugin-ui/`). No toast (no `setTimeout` that hides a message: grep test on `hh-toast` and the search notice's 4 s timer).
- [ ] **Steps 2–6** per the shape. Row 16.

### Task 31: InlineConfirm and EmptyState

**Files:** Create `packages/ui/src/guide/InlineConfirm.tsx`, `packages/ui/src/guide/EmptyState.tsx`. Modify the four confirmations in `ChatView.tsx` (pre-flight, level, time, mode) to `InlineConfirm` (look of row 72 is the orange notice with two compact buttons inside; layout in the chat lands in Part 9), delete-confirmations in Settings lists, and empty lists (grep `empty` keys in `en.json` → their components). Test `packages/ui/test/guide-messages.test.tsx`, `context-chat.test.tsx`, `pace.test.tsx`, `modes.test.tsx`.

- [ ] **Step 1: Failing test:** InlineConfirm renders inline (no portal), `Escape` calls `onCancel`, two compact buttons; EmptyState: icon 32 (the page's icon), title, one sentence, at most one primary action (TS: `action?: { label; onClick }`).
- [ ] **Steps 2–6** per the shape. Rows 72 (piece).

### Task 32: Dialog (440, r 18) and Popover / Menu (320, r 12, top bar)

**Files:** Create `packages/ui/src/guide/Dialog.tsx`, `Popover.tsx`, `Menu.tsx`. Modify `LanguagePicker.tsx` (pick language), `TranslateNotice.tsx` (translation notice and progress), destructive confirms that are dialogs today, `ProfileSwitcher.tsx` (avatar popover), `plugins/AttentionInbox.tsx` (bell popover), every "More" place built in Parts 5–6 (secret field, cards with a third action). Test `packages/ui/test/guide-overlays.test.tsx`, `language-picker.test.tsx`, `translate-notice.test.tsx`, `profiles.test.tsx`, `attention-inbox.test.tsx`.

- [ ] **Step 1: Failing test:**
  - Dialog: `role="dialog"` `aria-modal`, width `var(--hh-dialog-w)`, radius 18, `--hh-backdrop` behind; header title 20 + `Cerrar` IconButton (`close`); footer: danger left, secondary and primary right; focus trapped; `Escape` closes. Allowed content is text, fields, a list of options, a status line (documented in the component's JSDoc).
  - Popover: anchored to its top-bar button, width `var(--hh-popover-w)`, radius 12; rows with dot, title and one quiet action. Used only in the top bar (source scan: `Popover` imported only by `ProfileSwitcher.tsx`, `AttentionInbox.tsx`, and the top bar).
  - Menu: a Popover with `role="menu"` of `menuitem`s, text only, danger last.
- [ ] **Steps 2–6** per the shape. §8.

### Task 33: Tooltip rule and the one custom tooltip

**Files:** Create `packages/ui/src/guide/AnnotationTooltip.tsx`. Modify `AnnotateBlock.tsx` / `FocusMarkers.tsx` (whichever draws the annotation marks' tooltip today; grep `tooltip`), every other custom tooltip (grep `hh-tooltip`, `role="tooltip"`) → `title`. Test `packages/ui/test/guide-overlays.test.tsx`, `annotate.test.tsx`, `focus-markers.test.tsx`.

- [ ] **Step 1: Failing test:** source scan — `role="tooltip"` appears only in `guide/AnnotationTooltip.tsx`; the annotation mark shows it on hover and focus with one sentence. Row 29.
- [ ] **Steps 2–6** per the shape.

### Task 34: Search (⌘K) as the guide draws it

**Files:** Modify `packages/ui/src/search/SearchPalette.tsx`, `packages/ui/src/search/SearchHost.tsx`, `packages/ui/src/search/model.ts` (filter types, no scope filter), `packages/ui/src/search/local.ts` (references marked "solo lectura"), the floating 4 s notice (grep in `search/` and `HarnessApp.tsx`; row 17). Test `packages/ui/test/search-palette.test.tsx`, `search-host.test.tsx`, `search-model.test.ts`, `search-local-rows.test.tsx`, `packages/e2e/tests/search.spec.ts`.

- [ ] **Step 1: Failing tests:**
  - Frame: dialog 640 wide, radius 18, `top: 12%`, backdrop, no `Cerrar`; closes on `Escape`, ⌘K and click outside; focus trapped.
  - Field 52 tall, text 16, no own border, a line below; `search` icon left, "Esc" hint right; placeholder from OQ-1 ("Buscar tareas, notas, archivos, settings…"). §17.1: 52, not 56.
  - Filters: one line of 30 chips, horizontal scroll, never wraps; chosen one in `--hh-active`; "Todo · N" then one chip per type with results, with icon and count, in the fixed order Tareas, Notas, Archivos, Settings, Acciones, Datos (Datos only if the harness turns it on); ⌘1…⌘7 pick them.
  - Results: group titles 12 uppercase; rows 52 with grey type icon, title with the match marked in `--hh-active`, one 13 context line, optional grey tag on the right saying only "solo lectura" or when; chosen row grey fill; "Todo" up to 5 per group, filtered up to 50; no buttons in rows.
  - Footer: one 12 grey line `↑↓ moverse · Enter abrir · ⌘Enter preguntar a la IA · Esc cerrar` with boxed keys (`kbd`, DM Mono), no buttons (row 39).
  - States: empty → up to 8 recents then actions, no filters; indexing → status line "Indexando… 120 de 480" between field and results; no results → EmptyState with no buttons; partial → "Mostrando coincidencias parciales". Enter opens and closes; ⌘Enter closes and leaves a prepared question (query + up to 3 hints) in the composer, not sent.
  - No scope filters: `model.ts` has no "all scopes" / "reference folders" filter; references always come in, tagged "solo lectura" (row 40).
  - The floating search notice is a Notice under the top bar that does not vanish on its own (row 17).
- [ ] **Steps 2–6** per the shape. The top-bar search icon is Part 8 (row 36).

### Part 7 close

- [ ] Part gate green (`search*.spec.ts` updated); look check of search, dialogs, notices, empty states; offenders shrank. PR body: §7, §8, rows 16, 17, 29, 39, 40.

---

## How the screen tasks (Parts 8–14) work

Parts 8–14 move screens onto the pieces of Parts 3–7. They add no piece: if a screen needs something no piece gives, stop and ask (rule 1). Each task has this shape:

1. **Failing test** in the component's existing test file (named in the task) or in the new file the task names: render the screen or zone with its real props and assert the closed list of contents of its zone **in order** with `getAllByRole` / `within`, plus what must be gone. Use the helper below (add it in Task 35, in `packages/ui/test/zone.ts`):

```ts
import { within } from "@testing-library/react";
/** Accessible names of the direct interactive children of a zone, in DOM order. */
export function zoneNames(zone: HTMLElement): string[] {
  return within(zone)
    .queryAllByRole(/^(button|link|tab|switch|radio|status|img)$/ as unknown as "button")
    .map((el) => el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "");
}
```

2. **Run** `corepack pnpm exec vitest run <test file>` — FAIL.
3. **Implement** with guide pieces only; delete the old markup and its CSS rules; remove the offenders that disappear.
4. **Update** the e2e specs that drive the zone (named in the task): selectors move to roles and names.
5. **Run** the task's tests and `packages/ui/test/style-guard.test.ts` — PASS.
6. **Commit** `feat(ui): <zone> per the style guide (§<n>, rows <r>)`.

**Gate for every screen task:** `corepack pnpm exec vitest run <the task's tests> packages/ui/test/style-guard.test.ts`. **Part gate** as in "Gates", plus the look check of the screens the part touched, light and dark.

---

## Part 8 — Shell: top bar, rail, templates (`feat/sg-shell`, from `feat/sg-messages`)

**Area:** `packages/ui/src/chrome.tsx` (`TopBar`, `Rail`, `SidekickToggle`, `MockBadge` placement), `packages/ui/src/shell-nav.ts`, `packages/ui/src/guide/templates/{Work,Secondary,Home,Settings,Assistant}.tsx` (new), `packages/ui/src/guide/OneLineBar.tsx` (new), `packages/ui/src/HarnessApp.tsx`, `packages/ui/src/parallel/Inbox.tsx` (Bandeja pill), `packages/ui/src/SettingsPage.tsx` (top bar only), `packages/ui/test/zone.ts` (new), tests, `packages/e2e/tests/*.spec.ts` that click the rail or the top bar.
**Hotspots:** H2, H5, H6, H9 (`index.ts` exports of `TopBar`/`Rail` if they change).
**Spec:** §9 (rules for all, templates 1, 3, 4, 5, 6, 7), §10.1, §10.2, §3 one-line bars, §4 (top bar and rail icons). **Rows:** 6, 30 (placement), 31 (layout), 34, 36, 38 (piece), 74.
**Blocked by:** OQ-1, OQ-11 (harness rail pages), OQ-21 (breakpoints).

### Task 35: Top bar (40) with its closed list

**Files:** Modify `packages/ui/src/chrome.tsx` (`TopBar`), `packages/ui/src/HarnessApp.tsx` (what it passes), `packages/ui/src/parallel/Inbox.tsx` (remove the Bandeja pill), `packages/ui/src/SettingsPage.tsx` (top bar: `Volver` only; floppy/Save goes). Create `packages/ui/test/zone.ts`. Test `packages/ui/test/chrome.test.tsx`, `packages/ui/test/settings.test.tsx`, `packages/ui/test/harness-app.test.tsx`; e2e `packages/e2e/tests/settings.spec.ts`, `packages/e2e/tests/parallel*.spec.ts`.

- [ ] **Step 1: Failing test:**
  - Work screen with profiles, plugin notices, Sidekick and the test engine: the right side reads, outside in, `["Settings", "Buscar (⌘K)", <avatar>, <bell>, "Sidekick", "prueba"]` — reversed in DOM order — and nothing else; each piece is absent when its condition is false (no profiles → no avatar; no plugin notices → no bell; not the test engine → no "prueba"; not the work screen → no Sidekick).
  - Left: crumbs `Harness / Task`; the first crumb is a button to Inicio; the crumbs start 90 px after the window buttons (`rule(".hh-topbar-crumbs")["margin-left"]` or the padding the artifact shows; value 90 is the only allowed non-scale spacing, Task 8).
  - Height `40px` (`rule(".hh-topbar").height`).
  - No Bandeja pill anywhere in the top bar (row 6).
  - Settings: the top bar has exactly one control, a compact quiet `Button` with the `back` icon and the name of where you came from; no `settings`, no search, no save icon (rows 74; §12 Settings top bar; §4 Settings "The Save icon goes").
  - Assistant: only `Settings` on the right; no search icon (§17.2).
- [ ] **Steps 2–6** per the shape. Rows 6, 30 (the "prueba" tag sits last on the right), 74.

### Task 36: Search icon and the Sidekick button in the top bar

**Files:** Modify `packages/ui/src/chrome.tsx` (`SidekickToggle` → top-bar Sidekick button), `packages/ui/src/TaskHeader.tsx` (remove the Sidekick pill), `packages/ui/src/search/SearchHost.tsx` (open from the icon), `packages/ui/src/HarnessApp.tsx`. Test `packages/ui/test/chrome.test.tsx`, `packages/ui/test/task-header.test.tsx`, `packages/ui/test/search-host.test.tsx`; e2e `packages/e2e/tests/search.spec.ts`, `packages/e2e/tests/sidekick*.spec.ts`.

- [ ] **Step 1: Failing test:**
  - Search: an `IconButton icon="search"` with tooltip "Buscar (⌘K)" (OQ-1 English) on every screen except Settings and the Assistant; clicking it opens the palette of Task 34 (row 36).
  - Sidekick button: compact quiet, no border or fill (`rule` asserts `border: none` / transparent background, `surface-2` on hover), a `Dot` (green active · orange cards waiting · grey off) and text; `aria-pressed` reflects whether the right column is open; clicking toggles it (wiring to the column lands in Task 48 — here it toggles the same state `SidekickToggle` toggles today). Visible by default on the work screen only (row 34).
  - The task header has no Sidekick pill.
- [ ] **Steps 2–6** per the shape. Rows 34, 36.

### Task 37: Rail (64) with its closed entries

**Files:** Modify `packages/ui/src/shell-nav.ts` (entries and conditions), `packages/ui/src/chrome.tsx` (`Rail`), `packages/ui/src/HarnessApp.tsx`. Test `packages/ui/test/shell-nav.test.ts`, `packages/ui/test/chrome.test.tsx`; e2e every spec that clicks a rail entry (grep `hh-rail` and `getByRole("button", { name: "Notes"` in `packages/e2e/tests`).

- [ ] **Step 1: Failing test:**
  - `railEntries(...)` returns, in order, `home, tasks, inbox (if parallel), jobs (if jobs), files (if notes, references or material), plugins (if plugin panels), <harness pages>` — `notes` becomes `files`; `settings` is no longer a rail entry (it lives in the top bar).
  - Each entry is a 40 `IconButton` with an 18 icon from Task 12 and a tooltip with the name; Bandeja carries a `Counter` with the waiting tasks (row 6); selected entry has `background: var(--hh-cta)` (amber fill per §10.2) — if the artifact shows `--hh-active` instead, rule 1.
  - Rail width `var(--hh-rail-w)` (64, row 31); present on Work and Secondary templates, absent on Inicio, Settings and the Assistant.
  - Below 760 px it becomes a row on top (`@media (max-width: 760px)` rule exists; see OQ-21).
  - Harness pages: per OQ-11.
  - Each rail button navigates to a page; none opens a drawer or changes a column (assert the click changes the screen state, not a panel flag).
- [ ] **Steps 2–6** per the shape. Until Part 12 builds the pages, `files`, `jobs` and `plugins` open today's views inside a Secondary template shell (Task 38) so the app keeps working. Rows 6 (counter), 31.

### Task 38: The templates as components

**Files:** Create `packages/ui/src/guide/templates/{Work,Secondary,Home,Settings,Assistant}.tsx` (the Dialog template is `guide/Dialog.tsx` from Task 32; the split view lands in Task 51). Modify `packages/ui/src/HarnessApp.tsx` to render each screen through its template. Test `packages/ui/test/guide-templates.test.tsx` (new), `packages/ui/test/harness-app.test.tsx`.

- [ ] **Step 1: Failing test:**
  - `Work`: top bar · rail · slots `header`, `bars`, `chat`, `composer`, `left`, `right` in that layout; nothing else accepted (props typed to those slots).
  - `Secondary`: top bar with `Volver` on the left (compact quiet with the `back` icon and a name), rail with the page's entry selected, title 20, optional `view` (Segmented) and one `primary` action on the right of the title row, then `children`; with `empty` set, renders `EmptyState` (icon 32 + sentence + action) centered; `Escape` calls `onBack`.
  - `Home`: no rail; one centered column; the large button slot last.
  - `Settings`: top bar with `Volver` only; nav column `var(--hh-column-w)`; body.
  - `Assistant`: steps column on the left; action bar with exit slot on the left and advance slots on the right.
  - Rules of §9 as assertions: a `primary` slot renders last on the right of its bar; `Cerrar` (`close` icon) is rendered by no template except Dialog and SplitView (source scan of `guide/templates/`).
- [ ] **Steps 2–6** per the shape. §9.

### Task 39: One-line bars

**Files:** Create `packages/ui/src/guide/OneLineBar.tsx`. Test `packages/ui/test/guide-one-line-bar.test.tsx`.

- [ ] **Step 1: Failing test** (drive the width with a mocked `ResizeObserver` and `getBoundingClientRect`):

```tsx
const actions = [
  { id: "history", label: "Historial", icon: "history" as const, kind: "secondary" as const },
  { id: "new", label: "Nueva tarea", icon: "add" as const, kind: "primary" as const },
  { id: "end", label: "Terminar", kind: "secondary" as const }, // no icon pair
];
// width enough → step 1: secondary with border, primary amber
// less → step 2: all quiet, icon + text
// less → step 3: icon-only quiet IconButtons for history and new (tooltip = label); "Terminar" has no icon → it goes straight to step 4 (More)
// less → step 4: one More (⋯) IconButton opening a Menu with every action as text, same order
// the title never shrinks before step 4; after step 4 it ellipsizes (`text-overflow: ellipsis`)
// buttons never wrap: `flex-wrap: nowrap` on the bar
```

- [ ] **Steps 2–6** per the shape. Row 38 (piece; used in Tasks 40 and 41).

### Part 8 close

- [ ] Part gate green; look check of the work screen, a secondary page, Settings, Inicio, the Assistant; offenders shrank. PR body: §9, §10.1, §10.2, rows 6, 30, 31, 34, 36, 38, 74.

---

## Part 9 — Work screen: header, bars, chat, composer (`feat/sg-work`, from `feat/sg-shell`)

**Area:** `packages/ui/src/TaskHeader.tsx`, `packages/ui/src/parallel/TaskStrip.tsx`, `packages/ui/src/PhaseStepper.tsx`, `packages/ui/src/ModeList.tsx`, `packages/ui/src/ChatView.tsx`, `packages/ui/src/Message.tsx`, `packages/ui/src/ActivityList.tsx`, `packages/ui/src/tools/*.tsx`, `packages/ui/src/markdown.tsx`, `packages/ui/src/ChoicesBlock.tsx`, `packages/ui/src/InputBlock.tsx`, `packages/ui/src/ErrorCard.tsx`, `packages/ui/src/DocumentCards.tsx`, `packages/ui/src/StartView.tsx`, `packages/ui/src/UsageMeter.tsx`, `packages/ui/src/plugins/PluginChips.tsx`, `packages/ui/src/plugins/PreparedTask.tsx`, `packages/ui/src/ScopePicker.tsx`, `packages/ui/src/hatches/ScopeSettings.tsx`, `packages/ui/src/index.ts`, tests, e2e.
**Hotspots:** H2, H6, H9, H10.
**Spec:** §10.3–§10.7. **Rows:** 8, 28, 33, 35, 38 (use), 65, 66, 67, 68, 69, 70, 71, 72, 73.
**Blocked by:** OQ-1, OQ-12 (scope exports), OQ-23 (where plan usage goes).

### Task 40: Task header in one row; scope leaves the core

**Files:** Modify `packages/ui/src/TaskHeader.tsx`, `packages/ui/src/ChatView.tsx` (header slot), delete the scope UI: `packages/ui/src/ScopePicker.tsx`, `packages/ui/src/hatches/ScopeSettings.tsx` and their CSS, per OQ-12 for `packages/ui/src/index.ts`. Remove `PluginChips` from the header (`plugins/PluginChips.tsx` deleted if unused). Test `packages/ui/test/task-header.test.tsx`, `packages/ui/test/chat-look.test.tsx`, `packages/ui/test/scope*.test.tsx` (deleted with the scope UI); e2e `packages/e2e/tests/scope*.spec.ts` (deleted), `packages/e2e/tests/look.spec.ts`.

- [ ] **Step 1: Failing test:** `zoneNames(header)` equals `["<task title>", "Historial", "Nueva tarea"]` with parallel work and `["<task title>", "Historial"]` without; title is a 20 heading (`rule(".hh-task-title")["font-size"]` = `20px`, row 8); `Historial` is compact secondary with the `history` icon, `Nueva tarea` compact primary with the `add` icon; the bar is an `OneLineBar`; no scope select, no context meter, no plan usage, no plugin chips (rows 28, 35). Source scan: no `ScopePicker` import in `packages/ui/src` (row 28).
- [ ] **Steps 2–6** per the shape. The context chip moves under the composer in Task 46; plan usage goes per OQ-23 (Task 49 / Task 65). Rows 8, 28, 35, 38.

### Task 41: Task tabs and the phase and mode bar

**Files:** Modify `packages/ui/src/parallel/TaskStrip.tsx`, `packages/ui/src/PhaseStepper.tsx`, `packages/ui/src/ModeList.tsx`, `packages/ui/src/ChatView.tsx` (time, phase proposal, mode rows). Test `packages/ui/test/parallel-chat.test.tsx`, `packages/ui/test/phase-stepper.test.tsx`, `packages/ui/test/pace.test.tsx`, `packages/ui/test/modes.test.tsx`; e2e `packages/e2e/tests/phases*.spec.ts`, `packages/e2e/tests/modes*.spec.ts`.

- [ ] **Step 1: Failing test:**
  - Tabs: only with parallel work and more than one open task; one 40 `Tabs` tab per open task with name, orange `Dot` if it waits, phase `Tag`.
  - Phases row: done = green `Tag` with `check`, current = orange `Tag`, next = `Chip`s; `Terminar` compact secondary on the right; when narrow, next phases merge into one "+N" chip, then the buttons follow the `OneLineBar` steps (they have no icon, so 2 → 4).
  - Time row: `StatusLine` "quedan 12 min" (OQ-1) + `Pausar` / `Extender` compact quiet.
  - Phase proposal: info `Notice` with `Ir` (compact primary) and `Ahora no`.
  - Mode row: "Modo: …" + `Cambiar modo` (quiet) that unfolds a list of `Option`s below.
  - Each row appears only if the task has phases, time or modes; there is no button that hides a row.
- [ ] **Steps 2–6** per the shape. §10.4, §10.5, row 38.

### Task 42: Messages — your bubble, the agent's card, system lines

**Files:** Modify `packages/ui/src/Message.tsx`, `packages/ui/src/ChatView.tsx` (system notices). Test `packages/ui/test/message.test.tsx`, `packages/ui/test/chat-look.test.tsx`.

- [ ] **Step 1: Failing test:** your message is a bubble on the right with no "You" label (row 65); the agent's reply is a `Card` (padding 16) with the "+N archivos leídos" `Chip` on top when it read files, then the prose at 15/400 (row 66); a system notice is one grey 13 line centered between two dividers (row 71), used for mode or phase change, time, and another task touching your files.
- [ ] **Steps 2–6** per the shape. Rows 65, 66, 71.

### Task 43: Agent work and tool calls

**Files:** Modify `packages/ui/src/ActivityList.tsx`, `packages/ui/src/tools/*.tsx`, `packages/ui/src/ChatView.tsx` ("Trabajando…" line). Test `packages/ui/test/working.test.tsx`, `packages/ui/test/tools*.test.tsx`.

- [ ] **Step 1: Failing test:**
  - Working: a grey line with no box: `loading` icon + "Trabajando…" + `Ver detalle` (link) → list of steps with `check` or `loading` icon; when done, a foldable row "Revisó N cosas" with `chevron` (row 70).
  - Tool call: one grey 13 row per call — status icon (green `check`, `loading`, red `attention`) · name and datum · `chevron` on the right; opening shows data and result in a code block; a failed call starts open; calls group under a foldable "Preparó N cosas" (row 69).
- [ ] **Steps 2–6** per the shape. Rows 69, 70.

### Task 44: Markdown and document chips in the chat

**Files:** Modify `packages/ui/src/markdown.tsx`, `packages/ui/src/MermaidDiagram.tsx`, `packages/ui/src/DocumentCards.tsx`. Test `packages/ui/test/markdown.test.tsx`, `packages/ui/test/mermaid.test.tsx`, `packages/ui/test/document-cards.test.tsx`.

- [ ] **Step 1: Failing test:** headings render at 20 / 16 / 14 in the chat and in the reader (`rule(".hh-md h1")["font-size"]` = `20px`, h2 `16px`, h3 `14px`; the reader's em sizes are gone, row 73); code block has `Copiar` (compact quiet text button); Mermaid has `Ver fuente`; static checkboxes are not inputs (`disabled` or drawn as `check` icons per the artifact, rule 1); callouts use their icon (Task 15) and tag colors (Task 1); footnote back-link is text (Task 14); inline code uses DM Mono (Task 4); a document renders as a `Chip` with title and type that opens the Reader split view (wired in Task 51).
- [ ] **Steps 2–6** per the shape. Row 73.

### Task 45: Blocks, notices and the task start

**Files:** Modify `packages/ui/src/ChoicesBlock.tsx`, `packages/ui/src/RecommendModeBlock.tsx`, `packages/ui/src/AnnotateBlock.tsx`, `packages/ui/src/InputBlock.tsx`, `packages/ui/src/ErrorCard.tsx`, `packages/ui/src/ChatView.tsx` (the four confirmations, "usó otro modelo"), `packages/ui/src/StartView.tsx`. Test `packages/ui/test/choices.test.tsx`, `packages/ui/test/recommend-mode.test.tsx`, `packages/ui/test/input-block.test.tsx`, `packages/ui/test/error-card.test.tsx`, `packages/ui/test/context-chat.test.tsx`, `packages/ui/test/start-view.test.tsx`; e2e `packages/e2e/tests/choices*.spec.ts`, `packages/e2e/tests/start*.spec.ts`.

- [ ] **Step 1: Failing test:**
  - Options block: 52 `Option`s with radio; recommended amber; each carries a type `Tag`: Seguir orange, Profundizar blue, Preguntar violet; a chosen option no longer fills black (row 67).
  - Form block: inside a `Card` with title, fields (`FormField`), `Saltar` (secondary) · `Enviar` (primary) bottom right (row 68).
  - Error: red `Notice` with title, text and `Reintentar` · `Arreglar` bottom right.
  - Confirmation before starting, level and time: orange `Notice` with its icon and two compact buttons inside (`InlineConfirm` from Task 31; row 72).
  - "usó otro modelo": a `StatusLine` (info).
  - No task: topics as `Tile`s or a list, switched by `Segmented` Tarjetas / Lista, plus FAQ `Chip`s that send the question.
- [ ] **Steps 2–6** per the shape. Rows 67, 68, 72.

### Task 46: Composer

**Files:** Modify `packages/ui/src/ChatView.tsx` (composer), `packages/ui/src/plugins/PreparedTask.tsx`, `packages/ui/src/UsageMeter.tsx` (context chip with `Ring`), `packages/ui/src/sidekick/FlaggedText.tsx` (underline only). Test `packages/ui/test/composer.test.tsx` (new, or the composer cases in `chat-look.test.tsx`), `packages/ui/test/prepared-task.test.tsx`, `packages/ui/test/context-chat.test.tsx`; e2e `packages/e2e/tests/chat.spec.ts`.

- [ ] **Step 1: Failing test:**
  - Above (optional): the plugin's prepared task as a `Card` with title, text and `Empezar` (compact primary) / `Cancelar`.
  - Inside the field, bottom right, in order: `Revisar` (quiet, only with Sidekick) · `Detener` (secondary, only while working) · `Enviar` (compact secondary with border). `Enviar` is not `data-kind="primary"` (row 33). Nothing else inside the field but the typed text and these buttons.
  - Below, outside the field, 12 grey: the context `Chip` with `Ring` (opens the Context split view, Task 51), the caption ("Enter para enviar" / "Revisando… ⌘ para enviar ya"), the harness caption.
  - The work screen has no primary button unless one appears on its own (Aprobar, Arreglar, Ir): with an idle task, `queryAllByRole` of `[data-kind="primary"]` in the Work template is empty.
  - In the Assistant interview the composer is replaced by a primary `Empezar entrevista` (asserted in Task 61).
- [ ] **Steps 2–6** per the shape. Row 33.

### Part 9 close

- [ ] Part gate green; look check of a task with phases, time, mode, options, form, error, tools, markdown, and a narrow window (one-line bars); offenders shrank. PR body: §10.3–§10.7, rows 8, 28, 33, 35, 38, 65–73.

---

## Part 10 — Side columns and Sidekick (`feat/sg-columns`, from `feat/sg-work`)

**Area:** `packages/ui/src/FlowSide.tsx`, `packages/ui/src/sidekick/SidekickPanel.tsx`, `packages/ui/src/sidekick/PresetOffer.tsx`, `packages/ui/src/sidekick/ReviewHint.tsx`, `packages/ui/src/sidekick/FlaggedText.tsx`, `packages/ui/src/sidekick/word-diff.ts`, `packages/ui/src/sidekick/mark.tsx`, `packages/ui/src/ChatView.tsx` (column slots), `packages/ui/src/HarnessApp.tsx` (`renderSide`), tests, e2e.
**Hotspots:** H2, H5, H6, H9 (`renderSide` contract), H10.
**Spec:** §10.8, §10.9, Sidekick column. **Rows:** 5, 32, 37 (column), 41, 42, 43, 44 (placement), 58 (Sidekick).
**Blocked by:** OQ-1, OQ-11, OQ-23.

### Task 47: Left column shows only the walkthrough

**Files:** Modify `packages/ui/src/FlowSide.tsx`, `packages/ui/src/ChatView.tsx` (left slot). Test `packages/ui/test/flow-parts.test.tsx`, `packages/ui/test/flow-side.test.tsx`.

- [ ] **Step 1: Failing test:** with walkthrough mode, the column (width `var(--hh-column-w)`) holds, in order, the current question (with `Ring`), the label "Recorrido · N/M" and `NavItem`s with `StepMark` and `Tag` (Visto / Ahora / Sigue); no Notas, Referencias, Material, scope or plugin panels (row 37); without walkthrough mode the column is absent; no button shows or hides it; hidden below 640 px (OQ-21) and while the reader is full screen.
- [ ] **Steps 2–6** per the shape. Until Part 12, Notas, Referencias and Material stay reachable from the rail entry `files` (Task 37). Row 37.

### Task 48: One right column of 280 with one panel

**Files:** Modify `packages/ui/src/ChatView.tsx` (right slot), `packages/ui/src/sidekick/SidekickPanel.tsx` (outer frame), `packages/ui/src/HarnessApp.tsx` (`renderSide` goes into the same column), `styles.css` (the duplicate side-column, Sidekick, Sidekick card and dot rules collapse to one rule each, row 32). Test `packages/ui/test/right-column.test.tsx` (new), `packages/ui/test/sidekick-panel.test.tsx`, `packages/ui/test/styles.test.ts` (one-rule-per-selector check below); e2e `packages/e2e/tests/sidekick*.spec.ts`.

- [ ] **Step 1: Failing tests:**
  - Width `var(--hh-column-w)` (rows 5); header is only the open panel's title (15) + a `chevron` `IconButton` to fold; no panel-switching segmented.
  - Content is the Sidekick, or the harness panel when the harness has no Sidekick or it is off; with Sidekick on, the harness panel is not in the column (where it goes: OQ-11).
  - Folded: 52 wide, the marks of the active sidekicks stacked with their orange dot; one click opens it.
  - Shown or hidden by the top-bar Sidekick button (Task 36) and the header chevron; hidden while a split view is open and below 720 px (OQ-21).
  - Row 32: in `styles.test.ts`, `it("defines each side-column, Sidekick, Sidekick card and dot selector once")` counts top-level rules per selector among `.hh-side-col`, `.hh-sk-panel`, `.hh-sk-card`, `.hh-dot` (re-check names, rule 6) and expects 1.
- [ ] **Steps 2–6** per the shape. Rows 5, 32.

### Task 49: Sidekick header, status line, footer and states

**Files:** Modify `packages/ui/src/sidekick/SidekickPanel.tsx`, `packages/ui/src/sidekick/mark.tsx` (placement only). Test `packages/ui/test/sidekick-panel.test.tsx`.

- [ ] **Step 1: Failing test:**
  - Header: "Sidekick" (15) + chevron; nothing else (row 42).
  - Status line: the marks (24 circle, 14 icon) of the sidekicks on in this task, in the person's order; on the right the state in 12 — Mirando · Leyendo tu prompt… · Tiene una sugerencia · N avisos · Apagado; a mark with a waiting card has an orange `Dot`; clicking a mark opens a `Menu` with `Apagar en esta tarea` · `Ir a Settings` (rows 42, 44).
  - Footer: one 12 line with the Sidekick's spend in the task and the model level, plus a `ProgressBar` of that cap, fixed at the bottom; no plan usage (row 43; OQ-23).
  - States: Mirando = `EmptyState` without buttons; Revisando = `loading` icon and countdown text (the composer caption shows the same, Task 46); Apagado = grey marks, turned on from the top-bar button or the presentation card.
- [ ] **Steps 2–6** per the shape. Rows 42, 43, 44.

### Task 50: Sidekick cards — one anatomy, closed types

**Files:** Create `packages/ui/src/sidekick/SidekickCard.tsx`. Modify `packages/ui/src/sidekick/SidekickPanel.tsx`, `packages/ui/src/sidekick/PresetOffer.tsx`, `packages/ui/src/sidekick/ReviewHint.tsx`, `packages/ui/src/sidekick/FlaggedText.tsx`, `packages/ui/src/sidekick/word-diff.ts` (one changed-word style). Test `packages/ui/test/sidekick-card.test.tsx` (new), `packages/ui/test/sidekick-panel.test.tsx`, `packages/ui/test/review-hint.test.tsx`, `packages/ui/test/word-diff.test.ts`; e2e `packages/e2e/tests/sidekick*.spec.ts`.

- [ ] **Step 1: Failing test:**
  - Anatomy: radius 14, padding 12, text 13; parts in this order, absent ones skipped: who speaks (24 mark + name 13) with the moment's `Tag` on the right · title 13/600 · text or short list · rewrite block (grey fill, additions green) · "para después" rows · why (12, faint) with `No marcar esto` · actions on one line on the right, compact: dismiss (quiet) first, secondaries, the primary last; at most one primary and only on the live card; no icons but the mark and the notice tag's dot.
  - `type` is a closed union: `before-send | after-turn | lesson | notice | guard | daily-summary | place-reply | intro | harness-suggested | past | cap` (TS test with `// @ts-expect-error` on another value). Per type, the tag and the buttons of §10 Sidekick column: Antes de enviar → orange; `Enviar igual` (quiet) · `Editar` · `Enviar sugerido` (primary) (row 41); Después del turno → blue "Sigue"; `Descartar` · `Al composer`; Lección → violet; `Descartar` · `Al composer` (secondary); Aviso → orange with dot; only `Guardar como decisión` / `Terminar tarea` / `Ir a la tarea`; Guardia → red "Antes de aprobar" or orange "Cambio de fase"; `Aprobar igual` · `Revisar`; Resumen del día → grey "Ayer", up to 4 lines, `Descartar`; place reply → grey tag with the place's name, `Descartar`; Presentación → `Ahora no` · `Prender`; harness-suggested → rows with mark, name, purpose and `Adoptar`, `Ahora no` at the bottom; past → a 30 line (mark, what it was, grey result tag) that unfolds on click (§17.1: 30, not 36); cap → one line, no buttons, once per task.
  - The live card is on top with `--hh-shadow`; only cards of the open task.
  - Changed words: green fill for added, red fill struck through for removed — the same classes as the diff viewer (Task 54); no yellow (row 58).
- [ ] **Steps 2–6** per the shape. Rows 41, 58.

### Part 10 close

- [ ] Part gate green; look check of the work screen with walkthrough, Sidekick open, folded, off, and with a harness panel; offenders shrank. PR body: §10.8, §10.9, Sidekick column, rows 5, 32, 37, 41, 42, 43, 44, 58.

---

## Part 11 — Split view: reader, review, context (`feat/sg-split`, from `feat/sg-columns`)

**Area:** `packages/ui/src/guide/templates/SplitView.tsx` (new), `packages/ui/src/DocumentReader.tsx`, `packages/ui/src/ContextPanel.tsx`, `packages/ui/src/ReviewBar.tsx`, `packages/ui/src/ReviewColumn.tsx`, `packages/ui/src/FocusMarkers.tsx`, `packages/ui/src/review-marks.ts`, `packages/ui/src/FileDiff.tsx`, `packages/ui/src/EntryDiff.tsx`, `packages/ui/src/ApprovedDiff.tsx`, `packages/ui/src/ChatView.tsx` (split slot), tests, e2e.
**Hotspots:** H2, H6, H10.
**Spec:** §10.10, §2 special uses (diffs, review marks). **Rows:** 4, 57, 58 (diff viewer), 59, 60, 61, 62, 63, 64.
**Blocked by:** OQ-1, OQ-13 (compact 40 option), OQ-22 (index width).

### Task 51: SplitView template; Context

**Files:** Create `packages/ui/src/guide/templates/SplitView.tsx`. Modify `packages/ui/src/ChatView.tsx`, `packages/ui/src/ContextPanel.tsx`. Test `packages/ui/test/guide-templates.test.tsx`, `packages/ui/test/context-panel.test.tsx`; e2e `packages/e2e/tests/context*.spec.ts`.

- [ ] **Step 1: Failing test:** the split takes `var(--hh-split-w)` on the right of the chat and replaces the right column while open; header carries `Cerrar` (`close` icon); `Cerrar` or `Escape` closes; opening Reader closes Context and vice versa (row 4). Context: header "Contexto" + `Cerrar`; labeled sections in order — what is loaded (rows with size), `Agregar` (opens a `Menu`), notes, what is no longer in; opens from the context chip under the composer.
- [ ] **Steps 2–6** per the shape. Row 4.

### Task 52: Reader header, body and review bar

**Files:** Modify `packages/ui/src/DocumentReader.tsx`, `packages/ui/src/ReviewBar.tsx`. Test `packages/ui/test/document-reader.test.tsx`, `packages/ui/test/review-bar.test.tsx`; e2e `packages/e2e/tests/reader*.spec.ts`, `packages/e2e/tests/review*.spec.ts`.

- [ ] **Step 1: Failing test:**
  - Header: title 20, file crumbs, `text` IconButton (a `Menu` for size and width), `fullscreen` IconButton, `Cerrar`.
  - Body: index (width per OQ-22; hidden below 1000 px) + the 680 document at 16.
  - Footer: compact review bar — `Enviar comentarios (N)` on the left · status, `Ver cambios` · `Aprobar` (primary) on the right; buttons are 30 (row 63).
  - Opens from a document chip, a document link, or a file in Historial (the Historial entry lands in Task 58).
- [ ] **Steps 2–6** per the shape. Row 63.

### Task 53: Review marks, comment column, Bloquea, review questions

**Files:** Modify `packages/ui/src/review-marks.ts`, `packages/ui/src/FocusMarkers.tsx`, `packages/ui/src/ReviewColumn.tsx`, `packages/ui/src/ChatView.tsx` (the Bloquea chip in the chat). Create `packages/ui/src/guide/CompactOption.tsx` (the §15 exception; the only 40 option). Test `packages/ui/test/review-marks.test.ts`, `packages/ui/test/focus-markers.test.tsx`, `packages/ui/test/review-column.test.tsx`.

- [ ] **Step 1: Failing test:**
  - Marks: background + 2 px underline in the type's ink; question orange · comment blue · resolved grey · the active one `--hh-active` (row 59).
  - Margin dots in focus mode use the type's color, not amber (row 64).
  - Comment column (280) right of the document, in review only: one `Card` per comment with `Avatar`, a type `Tag` in the header — Pregunta orange, Comentario blue, Resuelto grey (row 61) — and a red `Bloquea` `Tag` if it blocks approval; the chat shows the same red tag; no `■` anywhere (source scan) (row 60).
  - A question is answered with `CompactOption` (40), used only inside `ReviewColumn` (source scan) (row 62; details per OQ-13).
  - Add `CompactOption` to `GUIDE_CLASSES` with the comment "§15 exception: comments column only".
- [ ] **Steps 2–6** per the shape. Rows 59, 60, 61, 62, 64.

### Task 54: Diffs — one style, markdown as lines

**Files:** Modify `packages/ui/src/FileDiff.tsx`, `packages/ui/src/EntryDiff.tsx`, `packages/ui/src/ApprovedDiff.tsx`, delete the rendered-markdown compare and its side bar (grep `rendered` / `md-compare` in these files). Test `packages/ui/test/file-diff.test.tsx`, `packages/ui/test/entry-diff.test.tsx`.

- [ ] **Step 1: Failing test:** lines with green (added) / red (removed) background and border (border color per OQ-4); words inside a line with green background, or red background struck through — the same classes the Sidekick uses (Task 50; row 58); a `Segmented` Inline / Side by side, side by side becomes inline below 900 px; a markdown file is compared as lines, like code: no rendered compare, no side bar (row 57).
- [ ] **Steps 2–6** per the shape. Rows 57, 58.

### Part 11 close

- [ ] Part gate green; look check of the reader, review with comments, context, a diff inline and side by side; offenders shrank. PR body: §10.10, rows 4, 57–64.

---

## Part 12 — Secondary pages (`feat/sg-pages`, from `feat/sg-split`)

**Area:** `packages/ui/src/pages/{FilesPage,HistoryPage,PluginsPage,JobsPage,InboxPage}.tsx` (new), `packages/ui/src/parallel/InboxBoard.tsx`, `packages/ui/src/parallel/Inbox.tsx`, `packages/ui/src/parallel/JobsTab.tsx`, `packages/ui/src/NotesPanel.tsx`, `packages/ui/src/MaterialPanel.tsx`, `packages/ui/src/hatches/LinkedFolders.tsx`, `packages/ui/src/HistoryPanel.tsx`, `packages/ui/src/FileTimelinePanel.tsx`, `packages/ui/src/Drawer.tsx` (removed), `packages/ui/src/plugins/PluginsSection.tsx`, `packages/ui/src/plugins/PanelFrame.tsx`, `packages/ui/src/HarnessApp.tsx`, `packages/ui/src/shell-nav.ts`, `packages/ui/src/settings-tabs.ts`, tests, e2e.
**Hotspots:** H2, H5, H6, H10.
**Spec:** §11, §9 template 3, §17.3. **Rows:** 1, 2, 3, 7, 37 (page).
**Blocked by:** OQ-1.

All pages use the `Secondary` template of Task 38: rail with the page's entry selected, title 20, the view (if any) and one primary on the right, `Volver` in the top bar (compact quiet with arrow), `Escape` goes back; from a detail `Volver` says the list's name ("← Notas") and goes to the list; from the list it says the task's name and goes to the task. Empty page: `EmptyState` with the page's icon at 32.

### Task 55: Bandeja page — list only

**Files:** Create `packages/ui/src/pages/InboxPage.tsx`. Modify `packages/ui/src/parallel/InboxBoard.tsx` (board view removed), `packages/ui/src/parallel/Inbox.tsx`. Test `packages/ui/test/inbox.test.tsx`; e2e `packages/e2e/tests/parallel*.spec.ts`.

- [ ] **Step 1: Failing test:** sections by state, each with a `Tag` + `Counter`; rows with title, `Chip`s, `ProgressBar`, level `Tag` and quiet `Cancelar`; no board (no columns view, no view switch); Jobs are not shown here (row 7). Volver behaviour per the template.
- [ ] **Steps 2–6** per the shape.

### Task 56: Jobs page

**Files:** Create `packages/ui/src/pages/JobsPage.tsx` (from `parallel/JobsTab.tsx`). Modify `packages/ui/src/settings-tabs.ts` (remove `jobs`), `packages/ui/src/HarnessApp.tsx`, `packages/ui/src/client.ts` (`SearchSettingsTab` loses `jobs`; search rows for Jobs open the page). Test `packages/ui/test/jobs-ui.test.tsx`, `packages/ui/test/settings-tabs.test.ts`, `packages/ui/test/search-local-rows.test.tsx`; e2e `packages/e2e/tests/jobs*.spec.ts`.

- [ ] **Step 1: Failing test:** one `Card` per job with `Toggle`, frequency, daily cap (compact `NumberField`) and its runs as foldable rows; `Correr ahora` secondary; Settings has no Jobs tab; the Bandeja has no Jobs view (row 7).
- [ ] **Steps 2–6** per the shape. Row 7.

### Task 57: Archivos page — Notas · Referencias · Material

**Files:** Create `packages/ui/src/pages/FilesPage.tsx`. Modify `packages/ui/src/NotesPanel.tsx`, `packages/ui/src/MaterialPanel.tsx`, `packages/ui/src/hatches/LinkedFolders.tsx` (become the three tabs' list and detail), `packages/ui/src/HarnessApp.tsx` (the `files` entry opens the page; the drawer route goes), `packages/ui/src/FlowSide.tsx` (nothing left to remove after Task 47; assert only). Test `packages/ui/test/files-page.test.tsx` (new), `packages/ui/test/notes-panel.test.tsx`, `packages/ui/test/material-panel.test.tsx`, `packages/ui/test/linked-folders.test.tsx`; e2e `packages/e2e/tests/notes*.spec.ts`, `packages/e2e/tests/material*.spec.ts`.

- [ ] **Step 1: Failing test:** 40 `Tabs` Notas · Referencias · Material, only those with content; each a list; picking a row opens its detail in the same column and `Volver` turns into "← Notas" (or the tab's name) and goes back to the list. Notas: rows with the `note` icon 14, learned or yours, `Editar` / `Borrar` (Borrar with `InlineConfirm`). Referencias: read only, rows with `lock` 14. Material: sources, with `Agregar` (primary, `add` icon) as the page's primary (rows 1, 37).
- [ ] **Steps 2–6** per the shape. Rows 1, 37.

### Task 58: Historial page; Drawer goes

**Files:** Create `packages/ui/src/pages/HistoryPage.tsx`. Modify `packages/ui/src/HistoryPanel.tsx`, `packages/ui/src/FileTimelinePanel.tsx`, `packages/ui/src/TaskHeader.tsx` (Historial opens the page), delete `packages/ui/src/Drawer.tsx` and its CSS and test. Test `packages/ui/test/history.test.tsx`, `packages/ui/test/file-timeline.test.tsx`, `packages/ui/test/drawer.test.tsx` (deleted); e2e `packages/e2e/tests/history*.spec.ts`.

- [ ] **Step 1: Failing test:** days with foldable rows per task; inside, files (open the Reader split or the timeline) and `Volver a este punto` with the `undo` icon; a file's timeline is a detail of the page and `Volver` goes back to the day; no `Drawer` import anywhere (source scan) (row 3).
- [ ] **Steps 2–6** per the shape. Row 3.

### Task 59: Plugins page

**Files:** Create `packages/ui/src/pages/PluginsPage.tsx`. Modify `packages/ui/src/plugins/PluginsSection.tsx` (leaves the task's left column), `packages/ui/src/plugins/PanelFrame.tsx`. Test `packages/ui/test/plugin-slots.test.tsx`, `packages/ui/test/plugins-page.test.tsx` (new); e2e `packages/e2e/tests/plugins*.spec.ts`.

- [ ] **Step 1: Failing test:** the plugin list on the left like Settings (`NavItem`s with a notice `Dot`); on the right the chosen plugin's panel iframe; a plugin with several panels shows 40 `Tabs` above the panel (§17.3); configuration stays in Settings › Plugins; the task's left column shows no plugin (row 2).
- [ ] **Steps 2–6** per the shape. Row 2.

### Part 12 close

- [ ] Part gate green; look check of the five pages, list and detail, empty states; offenders shrank. PR body: §11, rows 1, 2, 3, 7, 37.

---

## Part 13 — Inicio and Assistant (`feat/sg-home-setup`, from `feat/sg-pages`)

**Area:** `packages/ui/src/Home.tsx`, `packages/ui/src/PickUp.tsx`, `packages/ui/src/BackupNotice.tsx`, `packages/ui/src/LanguageChooser.tsx`, `packages/ui/src/SetupFlow.tsx`, `packages/ui/src/SetupStepsList.tsx`, `packages/ui/src/SetupStepForm.tsx`, `packages/ui/src/SetupInterviewStep.tsx`, `packages/ui/src/EngineOnboarding.tsx`, `packages/ui/src/FolderStep.tsx`, `packages/ui/src/ProfileStep.tsx`, `packages/ui/src/connections/ConnectStep.tsx`, tests, e2e.
**Hotspots:** H2, H6.
**Spec:** §12 Inicio, §12 Assistant, §9 templates 4 and 6. **Rows:** 19 (end), 20 (use), 21 (engine in the Assistant), 76 (Assistant), 81, 82, 83.
**Blocked by:** OQ-1, OQ-14 (engine without logo).

### Task 60: Inicio

**Files:** Modify `packages/ui/src/Home.tsx`, `packages/ui/src/PickUp.tsx`, `packages/ui/src/BackupNotice.tsx`, `packages/ui/src/LanguageChooser.tsx`. Test `packages/ui/test/home.test.tsx`, `packages/ui/test/home-look.test.tsx`, `packages/ui/test/pickup.test.tsx`; e2e `packages/e2e/tests/home*.spec.ts`, `packages/e2e/tests/look.spec.ts`.

- [ ] **Step 1: Failing test:**
  - Top bar right side: avatar · search · ⚙ (and nothing else).
  - Centered column, in order: logo 84 · name 28 (row 81) · sentence 15 · `Card` of missing steps with `StepMark`s, or a problem `Notice` · language `Notice` (`Más tarde` / `Elegir`) · large `Empezar` button with arrow, or `Configurar` (row 20) · engine `Chip` (logo 18, name, `Dot`, usage) · Retomar: a 12 uppercase grey label + task cards, absent when empty · backup `Notice`.
  - Section titles are 12 uppercase grey labels, not 15 (row 81).
  - Footer: brand and folder. No rail.
- [ ] **Steps 2–6** per the shape. Rows 20, 81.

### Task 61: Assistant — steps, body, action bar

**Files:** Modify `packages/ui/src/SetupFlow.tsx`, `packages/ui/src/SetupStepsList.tsx`, `packages/ui/src/SetupStepForm.tsx`, `packages/ui/src/SetupInterviewStep.tsx`, `packages/ui/src/EngineOnboarding.tsx`, `packages/ui/src/FolderStep.tsx`, `packages/ui/src/ProfileStep.tsx`, `packages/ui/src/connections/ConnectStep.tsx`. Test `packages/ui/test/setup-flow.test.tsx`, `packages/ui/test/engine-onboarding.test.tsx`, `packages/ui/test/folder-step.test.tsx`, `packages/ui/test/connect-step.test.tsx`; e2e `packages/e2e/tests/setup*.spec.ts`.

- [ ] **Step 1: Failing test:**
  - Left (280): `NavItem`s with `StepMark`, name and the chosen value (12); the current step has white fill with shadow and "Paso n de m".
  - Body: title 20 + sentence · the step: a form (`FormField`s), the engine as 52 `Option`s (rows 21, 76), place `Option`s, connection rows, or the interview (composer replaced by a primary `Empezar entrevista`) · engine install boxes: a `Card` with numbered steps, a code block and secondary buttons · foldable details with the log · a `StatusLine`.
  - Action bar: `Cancelar` (left) · `Atrás` (secondary) · `Saltar` (quiet, next to Siguiente; row 82) · `Siguiente` (primary); below, the caption "podés cambiarlo después" (OQ-1).
  - Top: a "Configurando…" `Notice` with `Cancelar` while a step runs.
  - Top bar: only ⚙ (§17.2).
- [ ] **Steps 2–6** per the shape. Rows 21, 76, 82.

### Task 62: Assistant end

**Files:** Modify `packages/ui/src/SetupFlow.tsx` (end screen). Test `packages/ui/test/setup-flow.test.tsx`; e2e `packages/e2e/tests/setup*.spec.ts`.

- [ ] **Step 1: Failing test:** the end shows an `EmptyState`-shaped block with the `check` icon at 32 (row 19 says "at the end, empty state with check 32"; §12 says "large step mark" — see OQ-24), summary `SettingsRow`s without controls, and the large `Empezar` button with the `next` arrow, as on Inicio (row 83); the 48 circle is gone.
- [ ] **Steps 2–6** per the shape. Rows 19, 20, 83.

### Part 13 close

- [ ] Part gate green; look check of Inicio (new and returning user) and every Assistant step and its end; offenders shrank. PR body: §12 Inicio and Assistant, rows 19, 20, 21, 76, 81, 82, 83.

---

## Part 14 — Settings (`feat/sg-settings`, from `feat/sg-home-setup`)

**Area:** `packages/ui/src/SettingsPage.tsx`, `packages/ui/src/settings-parts.tsx`, `packages/ui/src/settings-tabs.ts`, `packages/ui/src/EngineTab.tsx`, `packages/ui/src/hatches/EngineConfig.tsx`, `packages/ui/src/hatches/BackendCard.tsx`, `packages/ui/src/ModelsTab.tsx`, `packages/ui/src/UsageTab.tsx`, `packages/ui/src/connections/ConnectionsTab.tsx`, `packages/ui/src/sidekick/{SidekickTab,SidekickList,SidekickEditor,LearnedList,ImportSidekick,ScopeSidekicks}.tsx`, `packages/ui/src/plugins/{PluginsTab,PluginDetail,PermissionReview}.tsx`, `packages/ui/src/ProfilesSection.tsx`, `packages/ui/src/HarnessSettingsTab.tsx`, tests, e2e.
**Hotspots:** H2, H5, H6.
**Spec:** §12 Settings, §9 template 5. **Rows:** 49 (Modelos), 52, 53, 55, 75, 76, 77, 78, 79, 80.
**Blocked by:** OQ-1, OQ-14, OQ-23.

### Task 63: Settings frame — nav, section header, saving

**Files:** Modify `packages/ui/src/SettingsPage.tsx`, `packages/ui/src/settings-parts.tsx` (`SectionHead`), `packages/ui/src/settings-tabs.ts`. Test `packages/ui/test/settings.test.tsx`, `packages/ui/test/settings-parts.test.tsx`; e2e `packages/e2e/tests/settings.spec.ts`.

- [ ] **Step 1: Failing test:**
  - Left (280): title 20 · `NavItem`s in order General, Motor, Modelos, Uso, Conexiones, Sidekick, Plugins, the harness's own, each with an optional `Counter` (no Jobs: Task 56).
  - Section header has no title (row 75): a 13 grey sentence and, if needed, a control on the right.
  - Cards (`Card` with `data-pad="24"`) with title 15 and `SettingsRow`s; right of a card title only a `Tag`; a control (the Sidekick toggle, the engine in Niveles) drops to the card's first row.
  - Changes save themselves: no Save button on any tab (row 74 done in Task 35; assert here no button named "Save"/"Guardar" outside the secret field).
- [ ] **Steps 2–6** per the shape. Row 75.

### Task 64: Motor — engine as options, "Usar este motor" inside its card

**Files:** Modify `packages/ui/src/EngineTab.tsx`, `packages/ui/src/hatches/EngineConfig.tsx`, `packages/ui/src/hatches/BackendCard.tsx`. Test `packages/ui/test/engine-tab.test.tsx`, `packages/ui/test/engine-config.test.tsx`; e2e `packages/e2e/tests/engine*.spec.ts`.

- [ ] **Step 1: Failing test:** engines render as 52 `Option`s with the engine logo at 32 (no logo: OQ-14); no tiles, no ✓, one "chosen" style (row 76); `Usar este motor` is inside its card, bottom right, not above it (row 78).
- [ ] **Steps 2–6** per the shape. Rows 76, 78.

### Task 65: Modelos, Uso, Conexiones

**Files:** Modify `packages/ui/src/ModelsTab.tsx`, `packages/ui/src/UsageTab.tsx`, `packages/ui/src/connections/ConnectionsTab.tsx`. Test `packages/ui/test/models-tab.test.tsx`, `packages/ui/test/usage-tab.test.tsx`, `packages/ui/test/connections-ui.test.tsx`; e2e `packages/e2e/tests/models*.spec.ts`, `packages/e2e/tests/connections*.spec.ts`.

- [ ] **Step 1: Failing test:**
  - Modelos: no nested card (row 49); each changed value shows "Recomendado: …" in 12 grey only when different; no `Restaurar` button per row (row 55); `Restaurar todo` is a quiet button (row 80).
  - Uso: stats as `Card`s with label 12 and value 20; the usage `Table`; plan usage lives here (row 43 and OQ-23); `Ver planes` is a secondary link button (Task 16).
  - Conexiones: one `Avatar` 32 per connection (row 27 done in Task 28; assert); the secret field per Task 24 — one button + More (⋯) with `Borrar` (confirmed) and `Probar` (row 53); read-only data as `SettingsRow` without control, value as grey `Tag` (row 52).
- [ ] **Steps 2–6** per the shape. Rows 49, 52, 53, 55.

### Task 66: Sidekick, Plugins, profiles — loose lists, list and detail

**Files:** Modify `packages/ui/src/sidekick/{SidekickTab,SidekickList,SidekickEditor,LearnedList,ImportSidekick,ScopeSidekicks}.tsx`, `packages/ui/src/plugins/{PluginsTab,PluginDetail,PermissionReview}.tsx`, `packages/ui/src/ProfilesSection.tsx`, `packages/ui/src/HarnessSettingsTab.tsx`. Test `packages/ui/test/sidekick-tab.test.tsx`, `packages/ui/test/sidekick-list.test.tsx`, `packages/ui/test/plugins-tab.test.tsx`, `packages/ui/test/profiles-settings.test.tsx`, `packages/ui/test/harness-settings.test.tsx`; e2e `packages/e2e/tests/plugins*.spec.ts`, `packages/e2e/tests/sidekick*.spec.ts`, `packages/e2e/tests/profiles*.spec.ts`.

- [ ] **Step 1: Failing test:**
  - Lists (profiles, plugins, usage) are loose: a 13 grey group title + bordered rows, no `Card` around them.
  - Plugins: row with name, state `Tag`, `Toggle`; the detail uses the top-bar `Volver`, which turns into "← Plugins"; the plugin's own Back button is gone.
  - Small actions in a row (`Editar`, `Reactivar`, `Restaurar todo`) are quiet buttons (row 80).
  - Editors (a sidekick, a custom model) sit inside a `Card`; deleting asks with `InlineConfirm`; empty lists use `EmptyState`.
  - Settings › Sidekicks shows each sidekick's mark (24 circle, 14 icon).
- [ ] **Steps 2–6** per the shape. Row 80.

### Task 67: General and errors in Settings

**Files:** Modify `packages/ui/src/SettingsPage.tsx` (General: text size), every Settings tab's error rendering (grep `role="alert"` and `error` state in the files of this part's area). Test `packages/ui/test/settings.test.tsx`, `packages/ui/test/settings-errors.test.tsx` (new).

- [ ] **Step 1: Failing test:** text size is a `Segmented` (row 77; the piece swap was Task 17 — assert here in its place in General); a field error is red under the field (`FormField` / `SettingsRow` error); a page or group error (save failed) is a red `Notice` above the card; no other error style in Settings (source scan of the Settings files: errors only via `FormField`, `SettingsRow` or `Notice`) (row 79).
- [ ] **Steps 2–6** per the shape. Rows 77, 79.

### Part 14 close

- [ ] Part gate green; look check of every Settings tab, list and detail, error states, light and dark; offenders shrank. PR body: §12 Settings, rows 49, 52, 53, 55, 75–80.

---

## Part 15 — Plugin kit and demo (`feat/sg-plugin-kit`, from `feat/sg-settings`)

**Area:** `packages/ui/src/plugin-ui/components.tsx`, `packages/ui/src/plugin-ui/plugin-ui.css`, `packages/ui/src/plugin-ui/tokens.css`, `packages/ui/src/plugin-ui/index.ts`, `harnesses/demo/ui/*.tsx`, `harnesses/demo/ui/demo.css`, `harnesses/demo/plugins/on-this-day/panels/*`, `harnesses/demo/plugins/on-this-day/dist/*` (rebuilt), `packages/e2e/fixtures/plugins/probe/**`, `packages/cli/template/ui/harness.css`, `packages/ui/test/plugin-ui*.test.ts*`, `harnesses/demo/test/**`.
**Hotspots:** H4, H9 (`plugin-ui/index.ts` is a public export).
**Spec:** §15 Plugin panels, §15 Harness chat blocks, §16.5. **Rows:** 25, 26.
**Blocked by:** OQ-16 (aliases), OQ-17 (Clock, Empty, ErrorBar).

### Task 68: The kit is the compact pieces

**Files:** Modify `packages/ui/src/plugin-ui/components.tsx` (Table, `Button` compact, Chip, Stat; Clock/Empty/ErrorBar per OQ-17), `packages/ui/src/plugin-ui/index.ts`. Test `packages/ui/test/plugin-ui.test.tsx`.

- [ ] **Step 1: Failing test:** the kit exports exactly the names OQ-17 settles (today `Table`, `Chip`, `Clock`, `Stat`, `Empty`, `ErrorBar`; spec list: table, compact button, chip, stat); the button is 30 / radius 8 / 13 / 500 (was 24 / 6); the chip 30 / radius 8 / 500 (was 22); table rows 40 with 12 grey header; stat = label 12 + value 20 (row 25).
- [ ] **Steps 2–6** per the shape (CSS in `plugin-ui.css`, not `styles.css`).

### Task 69: Kit CSS on the shared tokens; fixtures rebuilt

**Files:** Modify `packages/ui/src/plugin-ui/plugin-ui.css` (`--hh-ok`, `--hh-warn`, `--hh-error-bg` → tag tokens), `packages/ui/src/plugin-ui/tokens.css` (aliases per OQ-16), `harnesses/demo/plugins/on-this-day/panels/*`, rebuild `harnesses/demo/plugins/on-this-day/dist/*` and `packages/e2e/fixtures/plugins/probe/dist/*` with their package build scripts (read each `package.json` `build` script; run it with `corepack pnpm --filter <name> build`). Test `packages/ui/test/plugin-ui-tokens.test.ts`, `packages/ui/test/style-guard.test.ts` (Task 11's plugin CSS scan now has no offenders for these files); e2e `packages/e2e/tests/plugins*.spec.ts`.

- [ ] **Step 1: Failing test:** `plugin-ui.css` uses no token outside the §2 tables (and the measure tokens of OQ-2); the `ALIASES` case in `plugin-ui-tokens.test.ts` is updated per OQ-16; the on-this-day panel uses only kit pieces (source scan of its panel files: imports only from `@humanharness/ui/plugin-ui`, no own `className` outside the kit's).
- [ ] **Steps 2–6** per the shape. Row 25.

### Task 70: Demo harness and the CLI template on the guide

**Files:** Modify `harnesses/demo/ui/*.tsx` (24 buttons → compact guide pieces, 11 px labels → 12), `harnesses/demo/ui/demo.css`, `harnesses/demo/ui/DiagramBlock.tsx` and `harnesses/demo/ui/events.css` (own CSS with tokens only; `--hh-highlight` → `--hh-active`), `packages/cli/template/ui/harness.css`. Test `harnesses/demo/test/demo-css.test.ts` (Task 7), `packages/ui/test/style-guard.test.ts`, `harnesses/demo/test/*.test.tsx`; e2e `packages/e2e/tests/demo*.spec.ts`.

- [ ] **Step 1: Failing test:** the harness CSS scan of Task 11 reports nothing for `harnesses/demo/**` and `packages/cli/template/**`; the demo's chat blocks render guide pieces (`Card`, `SettingsRow`, `Option`, `Button`, `Tag`) — assert by role/class in `harnesses/demo/test`; `DiagramBlock` keeps its own `<svg>` drawing (row 26) with only token colors.
- [ ] **Steps 2–6** per the shape. Rows 25, 26.

### Part 15 close

- [ ] Part gate green; look check of the demo's blocks and the on-this-day panel; offenders shrank. PR body: §15 Plugin panels and Harness chat blocks, rows 25, 26.

---

## Part 16 — Guide page and docs (`feat/sg-guide`, from `feat/sg-plugin-kit`)

**Area:** `packages/ui/src/guide/GuidePage.tsx` (new), `packages/ui/src/guide/registry.tsx` (new), `packages/ui/src/SettingsPage.tsx`, `packages/ui/src/settings-tabs.ts`, `packages/ui/src/client.ts`, `docs/style-guide.md` (new), `.github/pull_request_template.md` (new), `packages/ui/test/guide-page.test.tsx` (new), `packages/ui/test/style-guard.test.ts`, `packages/ui/test/style-guard-offenders.json`, `packages/ui/scripts/style-guard-init.ts` (removed).
**Hotspots:** H4, H5, H6, H7.
**Spec:** §1 (code is the source of truth), §15 Where it lives, §15 Control (checklist), §15 New piece / Exceptions (recorded in the doc), §16.6. **Rows:** 48 (doc).
**Blocked by:** OQ-1, OQ-18 (dev mode).

### Task 71: Settings › Guía de estilo (dev mode)

**Files:** Create `packages/ui/src/guide/registry.tsx` (one entry per piece: name, spec section, the real component rendered in each of its states and sizes), `packages/ui/src/guide/GuidePage.tsx`. Modify `packages/ui/src/settings-tabs.ts` (a `guide` tab, only in dev mode per OQ-18), `packages/ui/src/SettingsPage.tsx`, `packages/ui/src/client.ts` (dev-mode flag per OQ-18). Test `packages/ui/test/guide-page.test.tsx`.

- [ ] **Step 1: Failing test:**

```tsx
import { GUIDE } from "../src/guide/registry";
import * as pieces from "../src/guide";
it("the registry lists every exported piece and every icon (style guide §15 Where it lives)", () => {
  const exported = Object.keys(pieces).filter((k) => /^[A-Z]/.test(k)).sort();
  expect(GUIDE.map((e) => e.component).sort()).toEqual(exported);
});
it("renders every entry in light and dark", () => { /* render <GuidePage theme="light|dark"/>; each entry's heading is present; data-theme switches */ });
it("is a Settings tab only in dev mode", () => { /* settingsTabs({ dev: false }) has no "guide"; { dev: true } has it last */ });
```

- [ ] **Steps 2–6** per the shape. The page uses the Settings template; the order and grouping of entries follow the spec's sections (§2 measures as swatches and scales, §3–§8 pieces, §4 icons, §9 templates as small frames). Where the page needs a layout the spec does not give, follow artifact v29 (rule 1).

### Task 72: `docs/style-guide.md`

**Files:** Create `docs/style-guide.md`. Test `packages/ui/test/style-guide-doc.test.ts` (new).

- [ ] **Step 1: Failing test:** the doc exists and has one heading per spec rule group: Measures, Buttons and ways to choose, Icons, Form controls, Indicators, Messages, Overlays, Screen templates, Work screen zones, Secondary pages, Inicio / Assistant / Settings, What a harness may change, How the guide grows (new piece, exceptions with their four rows, harness chat blocks, plugin panels, control). It states row 48: a harness may change any token, light and dark, never add one or use a loose color. It names `Settings › Guía de estilo` as the live reference and the guard test as the control.
- [ ] **Step 3: Write it** from the spec, in English, restating rules only (no new rule). Link the guard test, the registry, and the PR checklist.
- [ ] **Steps 4–6** per the shape; commit `docs: style guide rules (style guide §15)`.

### Task 73: PR template with the UI checklist

**Files:** Create `.github/pull_request_template.md`. Test `packages/ui/test/style-guide-doc.test.ts` (one more case).

- [ ] **Step 1: Failing test:** the template exists and contains a "UI checklist (style guide)" section with these boxes: only guide pieces used · no loose color, size, radius, spacing or weight · icons only from the set, in their allowed places · each zone holds only its closed list · checked in light and dark · new piece or exception? → linked decision page and the guide row added in this PR (§15).
- [ ] **Steps 2–6** per the shape; commit `chore(github): PR template with the style-guide checklist`.

### Task 74: Close the guard

**Files:** Modify `packages/ui/test/style-guard.test.ts`, `packages/ui/test/style-guard-offenders.json` (must be `[]`), delete `packages/ui/scripts/style-guard-init.ts`, `packages/ui/src/guide/classes.ts` (complete). Test `packages/ui/test/style-guard.test.ts`.

- [ ] **Step 1: Failing test:** `expect(offenders).toEqual([])` and the file is removed from the test's inputs; `GUIDE_CLASSES` equals the classes found in the `/* guide: <Piece> */` blocks of `styles.css` (no extra, no missing). If offenders remain that no task removed, list them in the PR body under "Questions for Marco" and leave this step for after his answer.
- [ ] **Steps 2–6** per the shape.

### Part 16 close

- [ ] Part gate green; open Settings › Guía de estilo in dev mode, light and dark; screenshot attached. PR body: §1, §15, §16.6, row 48.

---

## Open questions for Marco

Each blocks the tasks named. Every question has a "Dejar para después" option: the task then skips that step, keeps today's behaviour for it, and lists it in the PR body.

**OQ-1 — English copy.** The spec writes the copy in Spanish; the app ships English and translates on demand. Blocks every task that adds or changes a string (Parts 4–16).
- A. Marco writes the English for each new or changed string; the plan's implementer lists the keys per part first.
- B. The implementer translates literally into English and Marco corrects in each PR.
- C. The Spanish copy goes into `en.json` as is.
- Dejar para después.

**OQ-2 — Measure tokens.** The spec fixes the scales (heights, radii, spacing, type) and lets a harness change "measures" by token (§1), but names only width tokens. Blocks Task 5, Task 8 (what "on the scale" means), Task 11, Task 69.
- A. Add one token per scale value (heights, radii, spacing, type sizes) that a harness may override; rules use only them.
- B. No new tokens beyond the widths and today's `--hh-control-h` / `--hh-control-r`; rules use the literal scale values and the guard checks them.
- Dejar para después.

**OQ-3 — Values off the scale today.** Gaps, paddings and sizes that are not on the scale (e.g. 2, 6, 10, 20 px). Blocks Tasks 1–7 where they appear.
- A. Each goes to the nearest scale value.
- B. The implementer lists them per screen and Marco decides each one.
- C. Follow artifact v29 per piece; what it does not show goes to B.
- Dejar para después.

**OQ-4 — Tokens and colors the tables do not say.** `--hh-logo`, `--hh-logo-ink`, `--hh-shadow-sm`, `--hh-on-ink`, the diff line border color, and which tag color each of the six callouts takes. Blocks Task 1, Task 54.
- A. Logo tokens and `--hh-shadow-sm` stay as exceptions; diff borders use the tag ink; callouts as Marco assigns.
- B. All map to existing tokens as Marco assigns per token.
- C. Follow artifact v29.
- Dejar para después.

**OQ-5 — Avatar colors already stored.** Profiles may hold coral, amber, teal, pink, gray; the SDK exports `PROFILE_COLORS` with the eight. Blocks Task 2.
- A. Map old to new (Marco gives the pairs) and keep the SDK list accepting old names.
- B. Change the SDK list to the six (breaking for harnesses) and map stored values.
- C. Reassign colors by order, ignoring stored values.
- Dejar para después.

**OQ-6 — 17 and 18 px text that is not a title.** `.hh-reader-large` (the large reading size) is 18. Blocks Task 4.
- A. It becomes 20.
- B. It becomes 16 (the reader size), so the size option goes.
- C. It stays as a new exception row in §15.
- Dejar para después.

**OQ-7 — Icon drawings.** The spec names the icons but not their drawings. `ClockIcon` is used today and has no name in §4. Blocks Tasks 12–13.
- A. Lucide paths (ISC license), stroke set to 1.75.
- B. The drawings of artifact v29.
- C. Marco provides them.
- For the clock: A. drop its uses; B. add a "Reloj" icon through §15; C. Dejar para después.

**OQ-8 — Sidekick marks already set.** Marks are emoji, a token dot or "spark" today; the SDK `mark` is a free string. Blocks Task 15.
- A. Map by purpose (prompt-coach → Coach, focus → Foco, process-guard → Guardián, mentor → Mentor, daily-summary → Resumen del día); custom sidekicks get the icon Marco names.
- B. Like A, and the SDK accepts old values for one release with a warning.
- C. Like A, and the SDK accepts only icon names now (breaking).
- Dejar para después.

**OQ-9 — The 12 field types vs the SDK.** §5 lists 12 types; the SDK has 7 input kinds (`text, longText, number, choice, multiChoice, pairs, boolean`) and 5 setting controls. Missing: secret, folder or file, slider, date, color. Blocks Task 24.
- A. Add the missing types to the SDK now.
- B. Build the pieces in the core, add them to the SDK only when a harness needs one.
- C. Keep the SDK as is; the core draws only today's kinds by the guide.
- Dejar para después.
- **OQ-9b:** "one of several" with 5 or 6 short values and no descriptions (the rule covers 2–4, with descriptions, and more than 6): A. Options; B. Select; C. Dejar para después.

**OQ-10 — Removing a key-value row.** "×" goes (§4) and Cerrar is only for dialogs and the split view, so the remove control has no icon. Blocks Task 14, Task 24.
- A. A quiet "Quitar" text button.
- B. A compact danger "Quitar".
- C. A new "Quitar" icon through §15.
- Dejar para después.

**OQ-11 — Harness pages on the rail.** The rail ends with "the harness's own pages" and the harness panel goes to "a rail page of its own" when the Sidekick is on, but the SDK has no page API (only `renderSide`) and §4 lists no icon for such an entry. Blocks Task 37, Task 48.
- A. Add an SDK page API: title, an icon from the set, a render function; the harness panel becomes one such page.
- B. No page API yet; with Sidekick on, the harness panel is hidden.
- C. No page API yet; with Sidekick on, the harness panel shares the column under a Segmented (contradicts "one panel only").
- Dejar para después.

**OQ-12 — Scope exports.** `ScopePicker` and `ScopeSettings` are public exports of `@humanharness/ui`. Blocks Task 40.
- A. Delete them and their exports (breaking).
- B. Keep the exports deprecated for one release, unused by the core.
- C. Move them to a separate package.
- Dejar para después.

**OQ-13 — The compact 40 option.** §10.10 and §15 name it but not its parts. Blocks Task 53.
- A. Same as Option (radio 18, title, no description) at 40, radius 12.
- B. Follow artifact v29.
- Dejar para después.

**OQ-14 — Engine without a logo.** §4 gives the Motor icon to "the engine tile when there is no logo", but the engine is no longer a tile (rows 21, 76). Blocks Task 61, Task 64.
- A. The Motor icon at 32 in the option's logo place.
- B. No image; the option starts with its title.
- Dejar para después.

**OQ-15 — Artifact v29 for unstated details.** Rule 1 sends implementers to the artifact when the spec is silent (hover shades, inner gaps). Affects every part.
- A. Yes, artifact v29 decides details the spec does not state.
- B. No, every unstated detail comes to Marco.
- Dejar para después.

**OQ-16 — Plugin token aliases.** `plugin-ui/tokens.css` exposes aliases (paper, sheet, segment, slate) and plugin CSS uses `--hh-ok`, `--hh-warn`, `--hh-error-bg`. Blocks Task 6, Task 69.
- A. Remove them; rebuild our fixtures (third-party panels break).
- B. Keep them one release, mapped to the new tokens.
- C. Keep them.
- Dejar para después.

**OQ-17 — Kit pieces outside the list.** The kit has `Clock`, `Empty` and `ErrorBar`; §15 lists table, compact button, chip, stat. Blocks Task 68.
- A. Remove the three.
- B. `Empty` and `ErrorBar` copy EmptyState and StatusLine; `Clock` goes.
- C. Keep them, each added through §15.
- Dejar para después.

**OQ-18 — Dev mode.** Settings › Guía de estilo appears "in dev mode", which the app does not have. Blocks Task 71.
- A. Unpackaged app (`!app.isPackaged`).
- B. An environment variable.
- C. A hidden switch in Settings › General.
- D. Always visible.
- Dejar para después.

**OQ-19 — "›" inside sentences.** Strings such as "Settings › Usage" use "›" as a path separator; §4 lists only "/" and "·" as separators. Blocks Task 14 (strings).
- A. Keep "›" in running text.
- B. Change it to "/".
- C. Rewrite those sentences without a path.
- Dejar para después.

**OQ-20 — Check on the chosen tile.** §3 says a chosen tile has "no check"; §4 lists "chosen tile (14)" for the check icon. Blocks Task 20.
- A. No check.
- B. Check 14.
- Dejar para después.

**OQ-21 — Breakpoints under the window minimum.** The rail becomes a row below 760, the right column hides below 720, the left below 640, but the window's minimum width is 900 (`packages/shell/src/main/index.ts`). Blocks Tasks 37, 47, 48.
- A. Build them as written (they apply only if the minimum changes).
- B. Lower the window minimum so they apply.
- C. Leave them out.
- Dejar para después.

**OQ-22 — Reader index width.** The index is 200 wide; 200 is not in the widths table. Blocks Task 52.
- A. A new width token.
- B. Literal 200 allowed only in the reader rule.
- Dejar para después.

**OQ-23 — Where plan usage goes.** §10.3 says plan usage moves "to the right column footer and Settings › Uso"; the Sidekick footer and row 43 say the footer shows the Sidekick's spend and plan usage goes back to Settings › Uso. Blocks Tasks 40, 49, 65.
- A. Only Settings › Uso.
- B. Settings › Uso, and the right column footer when the harness panel (not the Sidekick) is open.
- Dejar para después.

**OQ-24 — Assistant end mark.** Row 19 says "at the end, empty state with check 32"; §12 says "End: large step mark". Blocks Task 62.
- A. Empty state with check 32.
- B. A large step mark.
- Dejar para después.

---

## Coverage

### Spec sections

| Spec | Tasks |
|---|---|
| §1 Goal | 8–11 (closed world guard), 13–14 (no loose characters), 38 (fixed template parts), 70 (harness chat blocks), 71 (code is the source), 74 |
| §2 Heights | 5, 8, 16–28 (each piece's height) |
| §2 Widths | 3, 37, 38, 47, 48, 51 |
| §2 Radii and spacing | 5, 8, 16–29, 32 |
| §2 Type | 4, 8, 40, 44, 60 |
| §2 Color and special uses | 1, 2, 6, 15, 50, 53, 54 |
| §3 Button types | 16 |
| §3 One-line bars | 39, 40, 41 |
| §3 Ways to choose | 17, 18, 19, 20 |
| §3 Today's buttons | 16, 17, 18, 19, 20 |
| §4 Icons and marks | 12, 13, 14, 15, 28, 35–37 |
| §5 Form controls, form, 12 types, settings row | 21, 22, 23, 24, 25 |
| §6 Indicators | 26, 27, 28 |
| §6 Card | 29 |
| §7 Messages | 30, 31 |
| §8 Overlays | 32, 33 |
| §8 Search | 34, 36 |
| §9 Templates and rules | 38, 51, 32 (dialog), 55–59 |
| §10.1 Top bar | 35, 36 |
| §10.2 Rail | 37 |
| §10.3 Task header | 40 |
| §10.4 Task tabs | 18, 41 |
| §10.5 Phase and mode bar | 41 |
| §10.6 Chat | 42, 43, 44, 45 |
| §10.7 Composer | 46 |
| §10.8 Left column | 47 |
| §10.9 Right column | 48 |
| §10.10 Split view | 51, 52, 53, 54 |
| §10 Sidekick column | 49, 50 |
| §11 Secondary pages | 55, 56, 57, 58, 59 |
| §12 Inicio | 60 |
| §12 Assistant | 61, 62 |
| §12 Settings | 63, 64, 65, 66, 67 |
| §13 Migration list | see the table below |
| §14 Out of scope | respected: no harness repo is touched; scope only removed (40) |
| §15 New piece, exceptions | 53 (compact option), 33 (tooltip), 15 (callout icons), 16 (large button), 72, 73 |
| §15 Harness chat blocks | 7, 11, 70 |
| §15 Plugin panels | 68, 69 |
| §15 Control | 8–11, 73, 74 |
| §15 Where it lives | 71, 72 |
| §16.1–§16.6 | Parts 1, 2, 3–7, 8–14, 15, 16 |
| §17.1 (52 search field, 30 past card) | 34, 50 |
| §17.2 (no search in the Assistant) | 35, 36, 61 |
| §17.3 (plugin tabs) | 59 |

### Migration rows

| Row | Tasks | Row | Tasks | Row | Tasks |
|---|---|---|---|---|---|
| 1 | 57 | 29 | 33 | 57 | 54 |
| 2 | 59 | 30 | 26, 35 | 58 | 50, 54 |
| 3 | 58 | 31 | 3, 37 | 59 | 53 |
| 4 | 51 | 32 | 48 | 60 | 53 |
| 5 | 48 | 33 | 46 | 61 | 53 |
| 6 | 35, 37 | 34 | 36 | 62 | 53 |
| 7 | 55, 56 | 35 | 40 | 63 | 52 |
| 8 | 4, 40 | 36 | 36 | 64 | 53 |
| 9 | 16, 27 | 37 | 47, 57 | 65 | 42 |
| 10 | 21 | 38 | 39, 40, 41 | 66 | 42 |
| 11 | 4 | 39 | 34 | 67 | 45 |
| 12 | 14 | 40 | 34 | 68 | 45 |
| 13 | 12, 13 | 41 | 50 | 69 | 43 |
| 14 | 13 | 42 | 49 | 70 | 43 |
| 15 | 15 | 43 | 49, 65 | 71 | 42 |
| 16 | 30 | 44 | 15, 49 | 72 | 31, 45 |
| 17 | 34 | 45 | 1, 2 | 73 | 44 |
| 18 | 26 | 46 | 4 | 74 | 35 |
| 19 | 28, 62 | 47 | 4 | 75 | 63 |
| 20 | 16, 60, 62 | 48 | 1, 6, 72 | 76 | 20, 61, 64 |
| 21 | 20, 61 | 49 | 29, 65 | 77 | 17, 67 |
| 22 | 17 | 50 | 23 | 78 | 64 |
| 23 | 18, 41 | 51 | 24 | 79 | 67 |
| 24 | 22 | 52 | 25, 65 | 80 | 16, 65, 66 |
| 25 | 68, 69, 70 | 53 | 24, 65 | 81 | 4, 60 |
| 26 | 15, 70 | 54 | 4, 26 | 82 | 61 |
| 27 | 28 | 55 | 25, 65 | 83 | 62 |
| 28 | 40 | 56 | 21 | | |
