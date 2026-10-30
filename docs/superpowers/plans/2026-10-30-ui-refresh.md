# UI refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app the approved "soft cards" look: new tokens and font, one shell (top bar + icon rail + side columns), restyled screens, Home's "Pick up where you left", the Start view's Cards / List switch, the Inbox board, Settings as a page, drawers, and the "what happens next" copy rule.

**Status:** approved by Marco on 2026-10-30, every section as written. Not started: waits for `feat/protocol` to merge (see the gate below).

**Spec:** `docs/superpowers/specs/2026-10-30-ui-refresh-design.md` (approved 2026-10-30, Q1–Q6 defaults). Mockups: https://claude.ai/artifact/6WpeDVxxusFqaU6rJRH2RS.

**Architecture:** Tokens stay CSS custom properties in `packages/ui/src/styles.css` (`--hh-*`), renamed in one pass. The shell is two new pieces in `chrome.tsx` (`Rail`, a slotted `TopBar`) that `HarnessApp` places around every in-harness screen; screens stop putting their own controls in the top bar. New screens (`InboxBoard`, `SettingsPage`) reuse the existing hooks (`useTasks`, `useJobs`, the tab components), so no IPC or `client` change.

**Tech Stack:** React 18 + TypeScript, plain CSS, Vitest + Testing Library (happy-dom), Playwright e2e (`packages/e2e`), Electron renderer with a strict CSP (fonts bundled via `@fontsource`).

---

## Before you start (gate)

**Do not start Task 1 until `feat/protocol` is merged to master.** This plan is written against `feat/protocol` at a39263f; it rewrites most of `packages/ui`.

- [ ] **Step 1: Check the gate**

Run: `git fetch origin && git branch -r --contains a39263f | grep origin/master`
Expected: `origin/master`. If empty, stop.

- [ ] **Step 2: Branch from master**

```bash
git switch -c feat/ui-tokens origin/master
corepack pnpm install
corepack pnpm test
```
Expected: all tests pass before any change. Write down the count.

- [ ] **Step 3: Re-check the anchors this plan names.** For each file in "File map" below, open it and confirm the component/class still exists. Where a name moved, use the new name and note it in the PR body under "Conflicts with the plan". Do not re-design: the spec is the source of truth.

## Parts and branches

Eight parts, one PR each, stacked (each branch starts from the previous one; each PR targets the previous branch, the first targets master). Merge bottom-up with "delete branch" on.

| Part | Branch | Spec | Tasks |
|---|---|---|---|
| 1 Tokens and type | `feat/ui-tokens` | §3 | 1–4 |
| 2 Shell | `feat/ui-shell` | §4 | 5–9 |
| 3 Chat and start view | `feat/ui-chat` | §5.1, §5.3 | 10–14 |
| 4 Home | `feat/ui-home` | §5.2 | 15–16 |
| 5 Inbox board | `feat/ui-inbox` | §5.4 | 17–19 |
| 6 Settings page | `feat/ui-settings` | §5.5 | 20–23 |
| 7 Drawers and setup | `feat/ui-panels` | §5.6, §5.7 | 24–27 |
| 8 Copy pass | `feat/ui-copy` | §6 | 28–29 |

Each part ends with: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm e2e` green, then a PR body in the scratch folder.

## File map

| File | Part | Responsibility |
|---|---|---|
| `packages/ui/src/styles.css` | 1–7 | Tokens (§3) and every class rule |
| `packages/ui/src/plugin-ui/tokens.css` | 1 | Copy of the tokens for plugin panels, plus old-name aliases |
| `packages/shell/src/renderer/main.tsx` | 1 | Font imports |
| `packages/shell/package.json` | 1 | `@fontsource/dm-sans` replaces `@fontsource/lexend` |
| `packages/ui/src/chrome.tsx` | 2 | `TopBar` slots, new `Rail`, `Breadcrumb`, `Tag` |
| `packages/ui/src/shell-nav.ts` (new) | 2 | Which rail entries a harness gets (pure) |
| `packages/ui/src/HarnessApp.tsx` | 2, 5, 6 | Places the shell; screen state `chat | inbox | settings` |
| `packages/ui/src/ChatView.tsx` | 3 | Task header; empties the top bar |
| `packages/ui/src/TaskHeader.tsx` (new) | 3 | Title, subtitle, meters, Sidekick, History, New task |
| `packages/ui/src/parallel/TaskStrip.tsx` | 3 | Tabs per open task + phases |
| `packages/ui/src/FlowSide.tsx`, `ChoicesBlock.tsx`, `sidekick/SidekickPanel.tsx` | 3 | Restyle, tags |
| `packages/ui/src/StartView.tsx` | 3 | Header, Cards / List switch |
| `packages/ui/src/Home.tsx`, `PickUp.tsx` (new) | 4 | Home look, "Pick up where you left" |
| `packages/ui/src/parallel/InboxBoard.tsx` (new), `parallel/Inbox.tsx` | 5 | Board screen; Inbox becomes the top-bar pill |
| `packages/ui/src/SettingsPage.tsx` (renamed from `SettingsSheet.tsx`) | 6 | Full page with section list |
| `packages/ui/src/Drawer.tsx` (new) | 7 | Right drawer frame |
| `packages/ui/src/HistoryPanel.tsx`, `NotesPanel.tsx`, `ContextPanel.tsx`, `FileTimelinePanel.tsx`, `DocumentReader.tsx` | 7 | Use `Drawer` / restyle |
| `packages/ui/src/SetupFlow.tsx`, `EngineOnboarding.tsx` | 7 | Setup frame, engine tiles |
| `packages/i18n/src/locales/en.json` | 3–8 | New strings, copy rule |
| `packages/ui/test/*` | all | Tests per task |

Run one test file with: `corepack pnpm exec vitest run packages/ui/test/<file>`.

---

## Part 1 — Tokens and type (`feat/ui-tokens`)

### Task 1: New light and dark tokens

**Files:**
- Modify: `packages/ui/src/styles.css` (`:root` block and the `@media (prefers-color-scheme: dark)` block, top of file)
- Test: `packages/ui/test/styles.test.ts`

- [ ] **Step 1: Write the failing test.** Replace the first two tests in `describe("design tokens")`:

```ts
const LIGHT: Record<string, string> = {
  bg: "#f3f3f1", rail: "#fbfbfa", column: "#f8f8f6", surface: "#ffffff", "surface-2": "#f2f2ef",
  line: "#e7e7e3", "line-strong": "#d9d9d4", ink: "#1b1c1e", muted: "#62656b", faint: "#8a8d93",
  cta: "#fbd38d", "cta-ink": "#3b2a06", "cta-hover": "#f8c76e", active: "#fde6b3", "active-ink": "#7a4f00",
  logo: "#1b1c1e", "logo-ink": "#ffffff",
  "t-green": "#dff2e5", "t-green-ink": "#1d6e3f", "t-orange": "#fdebd7", "t-orange-ink": "#a94f08",
  "t-blue": "#e4ecfd", "t-blue-ink": "#2d55c4", "t-violet": "#ece6fb", "t-violet-ink": "#5f3dba",
  "t-red": "#fbe4e1", "t-red-ink": "#a3321f",
};
const DARK: Record<string, string> = {
  bg: "#121315", rail: "#16171a", column: "#17181b", surface: "#1e2024", "surface-2": "#26292e",
  line: "#2a2d32", "line-strong": "#383c42", ink: "#eceef0", muted: "#a3a8ae", faint: "#80858c",
  cta: "#f3c56a", "cta-ink": "#2a1d02", "cta-hover": "#f7d184", active: "#3a2e14", "active-ink": "#f3c56a",
  logo: "#eceef0", "logo-ink": "#121315",
  "t-green": "#17311f", "t-green-ink": "#8bd8a8", "t-orange": "#3a2715", "t-orange-ink": "#f4b47e",
  "t-blue": "#1c2944", "t-blue-ink": "#a3beff", "t-violet": "#29223f", "t-violet-ink": "#c6b4ff",
  "t-red": "#3b1d19", "t-red-ink": "#f3a497",
};
const TAGS = ["green", "orange", "blue", "violet", "red"];

it("uses the UI refresh palette in light and dark (spec §3.1)", () => {
  for (const [name, hex] of Object.entries(LIGHT)) expect(token(light, name), name).toBe(hex);
  for (const [name, hex] of Object.entries(DARK)) expect(token(dark, name), name).toBe(hex);
});

it("keeps text readable: ink ≥ 7:1 and muted ≥ 4.5:1 on every ground, each tag ink ≥ 4.5:1 on its fill", () => {
  for (const block of [light, dark]) {
    for (const bg of ["bg", "rail", "column", "surface", "surface-2"]) {
      expect(ratio(token(block, "ink"), token(block, bg)), `ink on ${bg}`).toBeGreaterThanOrEqual(7);
      expect(ratio(token(block, "muted"), token(block, bg)), `muted on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const t of TAGS) expect(ratio(token(block, `t-${t}-ink`), token(block, `t-${t}`)), t).toBeGreaterThanOrEqual(4.5);
    expect(ratio(token(block, "cta-ink"), token(block, "cta"))).toBeGreaterThanOrEqual(7);
    expect(ratio(token(block, "active-ink"), token(block, "active"))).toBeGreaterThanOrEqual(4.5);
  }
});

it("drops the renamed tokens (paper, sheet, segment, slate)", () => {
  for (const old of ["paper", "sheet", "segment", "slate"]) expect(css).not.toMatch(new RegExp(`--hh-${old}:`));
});
```

Keep the diff/review test; change its `token(block, "ok")` to `token(block, "t-green-ink")`.

- [ ] **Step 2: Run it.** `corepack pnpm exec vitest run packages/ui/test/styles.test.ts` → FAIL (`--hh-bg` not found).

- [ ] **Step 3: Implement.** In `styles.css` `:root`, replace `--hh-paper` … `--hh-segment` with the `LIGHT` values above as `--hh-<name>: <hex>;`, plus:

```css
  --hh-shadow: 0 1px 2px rgba(20, 20, 20, 0.04), 0 8px 24px rgba(20, 20, 20, 0.05);
  --hh-backdrop: rgba(27, 28, 30, 0.18);
  --hh-on-ink: var(--hh-bg);
  /* Aliases kept for existing rules: same meaning, new source (spec §3.1). */
  --hh-ok: var(--hh-t-green-ink);
  --hh-ok-dot: var(--hh-t-green-ink);
  --hh-warn: var(--hh-t-orange-ink);
  --hh-error-bg: var(--hh-t-red);
  --hh-highlight: var(--hh-active);
```

Do the same in the dark block with the `DARK` values and `--hh-shadow: 0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.25); --hh-backdrop: rgba(0,0,0,.45);`. Keep the profile, callout, review and diff tokens.

Note: `token()` in the test reads `#hex` only; aliases (`var(...)`) are skipped by it on purpose.

- [ ] **Step 4: Rename uses.** Replace every `var(--hh-paper)` → `var(--hh-bg)`, `var(--hh-sheet)` → `var(--hh-rail)`, `var(--hh-segment)` → `var(--hh-surface-2)`, `var(--hh-slate)` → `var(--hh-muted)` across `packages/ui/src` and `packages/cli/template/ui/harness.css`:

```bash
grep -rl -- '--hh-\(paper\|sheet\|segment\|slate\)' packages/ui/src packages/cli/template packages/blocks | grep -v tokens.css \
  | xargs sed -i '' -e 's/--hh-paper/--hh-bg/g' -e 's/--hh-sheet/--hh-rail/g' -e 's/--hh-segment/--hh-surface-2/g' -e 's/--hh-slate/--hh-muted/g'
```

- [ ] **Step 5: Check the untouched tokens' contrast.** Add to the diff/review test: `for (const bg of ["review-question", "review-done", "review-comment", "callout-note", "callout-tip", "callout-warning", "callout-summary", "callout-decision", "callout-question"]) expect(ratio(token(block, "ink"), token(block, bg))).toBeGreaterThanOrEqual(4.5);` Run; adjust only the values that fail (lighten in light, darken in dark), and list them in the PR body.

- [ ] **Step 6: Run** `corepack pnpm exec vitest run packages/ui/test/styles.test.ts` → PASS. Then `corepack pnpm test` → only `plugin-ui-tokens.test.ts` may fail (Task 2).

- [ ] **Step 7: Commit** `git commit -am "feat(ui): UI refresh tokens, light and dark"`

### Task 2: Plugin panel tokens follow, with aliases

**Files:**
- Modify: `packages/ui/src/plugin-ui/tokens.css`
- Test: `packages/ui/test/plugin-ui-tokens.test.ts`

- [ ] **Step 1: Write the failing test.** Add:

```ts
it("keeps the pre-refresh names as aliases for published plugins (one release)", () => {
  const light = tokens(block(panel, ":root"));
  expect(light.get("--hh-paper")).toBe("var(--hh-bg)");
  expect(light.get("--hh-sheet")).toBe("var(--hh-rail)");
  expect(light.get("--hh-segment")).toBe("var(--hh-surface-2)");
  expect(light.get("--hh-slate")).toBe("var(--hh-muted)");
});
```

- [ ] **Step 2: Run** → FAIL (both the existing equality test and the new one).
- [ ] **Step 3: Implement.** Copy the new `:root` and dark blocks from `styles.css` into `tokens.css` verbatim, then append to its `:root`:

```css
  /* Pre-refresh names, kept one release for published plugins (UI refresh spec §3.1). */
  --hh-paper: var(--hh-bg);
  --hh-sheet: var(--hh-rail);
  --hh-segment: var(--hh-surface-2);
  --hh-slate: var(--hh-muted);
```

If the existing equality test compares every token of the panel to the app, make it skip these four names (`["--hh-paper","--hh-sheet","--hh-segment","--hh-slate"]`).

- [ ] **Step 4: Run** the file → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(plugin-ui): follow the refresh tokens, alias the old names"`

### Task 3: DM Sans, bundled

**Files:**
- Modify: `packages/shell/package.json`, `packages/shell/src/renderer/main.tsx`, `packages/ui/src/styles.css`
- Test: `packages/ui/test/styles.test.ts`, `packages/shell/test/renderer-csp.test.ts` (unchanged, must stay green)

- [ ] **Step 1: Write the failing test** (styles.test.ts, `describe("styles")`):

```ts
it("uses DM Sans for text and display, 14px base (spec §3.2)", () => {
  expect(css).toMatch(/--hh-font:\s*"DM Sans",/);
  expect(css).toMatch(/--hh-display:\s*var\(--hh-font\)/);
  expect(css).toMatch(/:root\s*{[^}]*font-size:\s*14px/);
  expect(css).not.toMatch(/Lexend/);
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**

```bash
corepack pnpm --filter @humanharness/shell remove @fontsource/lexend
corepack pnpm --filter @humanharness/shell add @fontsource/dm-sans
```

`main.tsx`:

```tsx
// DM Sans for all text, bundled with the app (no network fonts: the renderer's CSP allows 'self' only).
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
```

`styles.css` `:root`:

```css
  --hh-font: "DM Sans", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --hh-display: var(--hh-font);
  font-family: var(--hh-font);
  font-size: 14px;
```

- [ ] **Step 4: Run** styles test → PASS; `corepack pnpm --filter @humanharness/shell build` → builds, woff2 files land in `out/renderer/assets`.
- [ ] **Step 5: Commit** `git commit -am "feat(ui): DM Sans, bundled; 14px base"`

### Task 4: Base controls — CTA, pill, tag, chip, card, radii

**Files:**
- Modify: `packages/ui/src/styles.css` (base `button`, `.hh-primary`, `.hh-start`, new `.hh-cta`, `.hh-pill`, `.hh-tag*`, `.hh-chip`, `.hh-card`), `packages/ui/src/chrome.tsx` (new `Tag`)
- Test: `packages/ui/test/styles.test.ts`, `packages/ui/test/chrome.test.tsx`

- [ ] **Step 1: Write the failing tests.**

styles.test.ts:

```ts
it("has the soft-cards controls: amber CTA, tags by meaning, no chamfer (spec §3.2–3.3)", () => {
  expect(css).toMatch(/^\.hh-primary,\s*\.hh-cta\s*{[^}]*background:\s*var\(--hh-cta\)[^}]*color:\s*var\(--hh-cta-ink\)/m);
  expect(css).not.toMatch(/clip-path:\s*polygon/);
  for (const t of ["green", "orange", "blue", "violet", "red"])
    expect(css).toMatch(new RegExp(`^\\.hh-tag-${t}\\s*{\\s*background:\\s*var\\(--hh-t-${t}\\);\\s*color:\\s*var\\(--hh-t-${t}-ink\\)`, "m"));
  expect(css).toMatch(/^\.hh-tag-gray\s*{\s*background:\s*var\(--hh-surface-2\);\s*color:\s*var\(--hh-muted\)/m);
  expect(css).toMatch(/^\.hh-card\s*{[^}]*border-radius:\s*14px/m);
});
```

chrome.test.tsx:

```tsx
it("Tag colours a state by its meaning", () => {
  render(<Tag tone="orange">Waiting for you</Tag>);
  expect(screen.getByText("Waiting for you").className).toBe("hh-tag hh-tag-orange");
});
```

- [ ] **Step 2: Run** both → FAIL.
- [ ] **Step 3: Implement.** In `chrome.tsx`:

```tsx
export type TagTone = "green" | "orange" | "blue" | "violet" | "red" | "gray";

/** A state, coloured by what it means (UI refresh spec §3.3): green done, orange now/waiting, blue info, violet deep/suggestion, red failed, gray neutral. */
export function Tag({ tone, children }: { tone: TagTone; children: ReactNode }) {
  return <span className={`hh-tag hh-tag-${tone}`}>{children}</span>;
}
```

In `styles.css`, replace the `button, .hh-button`, `.hh-primary` and both `.hh-start` rules with:

```css
button, .hh-button { font: inherit; display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; padding: 0 14px; border-radius: 11px; border: 1px solid var(--hh-line); background: var(--hh-surface); color: var(--hh-ink); text-decoration: none; cursor: default; }
button:hover:not(:disabled), .hh-button:hover { border-color: var(--hh-line-strong); }
.hh-primary, .hh-cta { min-height: 44px; padding: 0 18px; border-radius: 12px; border-color: transparent; background: var(--hh-cta); color: var(--hh-cta-ink); font-weight: 600; }
.hh-primary:hover:not(:disabled), .hh-cta:hover:not(:disabled) { background: var(--hh-cta-hover); border-color: transparent; }
.hh-start { min-height: 52px; padding: 0 26px; border-radius: 14px; font-size: 16px; }
.hh-icon-button { width: 44px; height: 44px; padding: 0; border: 0; border-radius: 12px; background: transparent; color: var(--hh-muted); }
.hh-icon-button:hover { background: var(--hh-surface-2); color: var(--hh-ink); }
.hh-tag { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px; border-radius: 7px; font-size: 12.5px; font-weight: 500; white-space: nowrap; }
.hh-tag-green { background: var(--hh-t-green); color: var(--hh-t-green-ink); }
.hh-tag-orange { background: var(--hh-t-orange); color: var(--hh-t-orange-ink); }
.hh-tag-blue { background: var(--hh-t-blue); color: var(--hh-t-blue-ink); }
.hh-tag-violet { background: var(--hh-t-violet); color: var(--hh-t-violet-ink); }
.hh-tag-red { background: var(--hh-t-red); color: var(--hh-t-red-ink); }
.hh-tag-gray { background: var(--hh-surface-2); color: var(--hh-muted); }
.hh-card { background: var(--hh-surface); border: 1px solid var(--hh-line); border-radius: 14px; }
```

The existing `.hh-chip` rule (start view) keeps its single definition (a test pins it); change its body to `height: 30px; display: inline-flex; align-items: center; padding: 0 9px; border-radius: 7px; background: var(--hh-surface); border: 1px solid var(--hh-line); font-size: 12.5px;`. Focus ring inside the CTA: `.hh-primary:focus-visible, .hh-cta:focus-visible { outline: 2px solid var(--hh-cta-ink); outline-offset: -4px; }` (replaces the `.hh-start:focus-visible` rule).

- [ ] **Step 4: Run** `corepack pnpm test` → PASS. Fix snapshot-like class assertions that named `hh-primary hh-start` only if they now fail for a reason other than look.
- [ ] **Step 5: e2e** `corepack pnpm e2e` → PASS.
- [ ] **Step 6: Commit** `git commit -am "feat(ui): soft-cards controls: amber CTA, tags, cards"` — Part 1 PR body: tokens table, contrast values adjusted in Task 1 Step 5, alias note.

---

## Part 2 — Shell (`feat/ui-shell`, from `feat/ui-tokens`)

### Task 5: Which rail entries a harness gets

**Files:**
- Create: `packages/ui/src/shell-nav.ts`
- Test: `packages/ui/test/shell-nav.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { railEntries } from "../src/shell-nav";

describe("railEntries (spec §4.2)", () => {
  it("gives a plain harness Home, Tasks and Settings (D0)", () => {
    expect(railEntries({ parallel: false, jobs: false, notes: false, pluginPanels: false })).toEqual(["home", "tasks", "settings"]);
  });
  it("adds Inbox with parallel, Jobs only with declared jobs, Notes, Plugins", () => {
    expect(railEntries({ parallel: true, jobs: true, notes: true, pluginPanels: true })).toEqual(["home", "tasks", "inbox", "jobs", "notes", "plugins", "settings"]);
    expect(railEntries({ parallel: true, jobs: false, notes: false, pluginPanels: false })).toEqual(["home", "tasks", "inbox", "settings"]);
  });
});
```

- [ ] **Step 2: Run** → FAIL (module missing).
- [ ] **Step 3: Implement**

```ts
/** The icon rail's entries (UI refresh spec §4.2): an entry shows only when the harness has the feature (D0). */
export type RailEntry = "home" | "tasks" | "inbox" | "jobs" | "notes" | "plugins" | "settings";

export interface RailFeatures {
  parallel: boolean;
  jobs: boolean;
  notes: boolean;
  pluginPanels: boolean;
}

export function railEntries(f: RailFeatures): RailEntry[] {
  const out: RailEntry[] = ["home", "tasks"];
  if (f.parallel) out.push("inbox");
  if (f.parallel && f.jobs) out.push("jobs");
  if (f.notes) out.push("notes");
  if (f.pluginPanels) out.push("plugins");
  out.push("settings");
  return out;
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "feat(ui): rail entries per declared feature"`

### Task 6: `Rail` component

**Files:**
- Modify: `packages/ui/src/chrome.tsx`, `packages/ui/src/styles.css`, `packages/i18n/src/locales/en.json` (`rail.*`)
- Test: `packages/ui/test/chrome.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("Rail labels each entry, marks the current one and reports picks", async () => {
  const onPick = vi.fn();
  await renderIn("en", <Rail entries={["home", "tasks", "inbox", "settings"]} current="tasks" onPick={onPick} />);
  const nav = screen.getByRole("navigation", { name: "App" });
  expect(within(nav).getByRole("button", { name: "Tasks" }).getAttribute("aria-current")).toBe("page");
  expect(within(nav).getByRole("button", { name: "Home" }).getAttribute("aria-current")).toBeNull();
  fireEvent.click(within(nav).getByRole("button", { name: "Inbox" }));
  expect(onPick).toHaveBeenCalledWith("inbox");
});
```

(import `renderIn` from `./render`, `within` from Testing Library.)

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** en.json: `"rail": { "label": "App", "home": "Home", "tasks": "Tasks", "inbox": "Inbox", "jobs": "Jobs", "notes": "Notes", "plugins": "Plugins", "settings": "Settings" }`. chrome.tsx:

```tsx
const RAIL_ICONS: Record<RailEntry, ReactNode> = {
  home: <path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />,
  tasks: <><path d="M5 5h14v10H9l-4 4z" /><path d="M9 9h6" /></>,
  inbox: <><path d="M4 13l2.5-7h11L20 13v6H4z" /><path d="M4 13h5l1 2h4l1-2h5" /></>,
  jobs: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
  notes: <><path d="M7 4h8l4 4v12H7z" /><path d="M10 12h6M10 16h4" /></>,
  plugins: <path d="M13 3L5 13h6l-1 8 8-10h-6z" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></>,
};

/** The icon rail (UI refresh spec §4.2): the screens of a harness, Settings at the bottom. */
export function Rail({ entries, current, onPick }: { entries: RailEntry[]; current: RailEntry; onPick: (e: RailEntry) => void }) {
  const { t } = useTranslation();
  const button = (e: RailEntry) => (
    <button key={e} className="hh-icon-button hh-rail-item" aria-label={t(`rail.${e}`)} title={t(`rail.${e}`)} aria-current={e === current ? "page" : undefined} onClick={() => onPick(e)}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {RAIL_ICONS[e]}
      </svg>
    </button>
  );
  return (
    <nav className="hh-rail" aria-label={t("rail.label")}>
      {entries.filter((e) => e !== "settings").map(button)}
      <span className="hh-spacer" />
      {entries.includes("settings") && button("settings")}
    </nav>
  );
}
```

styles.css:

```css
.hh-rail { flex: 0 0 76px; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 18px 0; background: var(--hh-rail); border-right: 1px solid var(--hh-line); }
.hh-rail-item[aria-current="page"] { background: var(--hh-active); color: var(--hh-active-ink); }
@media (max-width: 760px) { .hh-rail { flex-direction: row; flex-basis: auto; padding: 10px 16px; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--hh-line); } .hh-rail .hh-spacer { display: none; } }
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "feat(ui): icon rail"`

### Task 7: Slotted `TopBar` with breadcrumb

**Files:**
- Modify: `packages/ui/src/chrome.tsx`, `packages/ui/src/styles.css`
- Test: `packages/ui/test/chrome.test.tsx`, `packages/ui/test/styles.test.ts`

- [ ] **Step 1: Write the failing tests**

```tsx
it("TopBar shows the logo, a breadcrumb whose last part is the current page, and trailing controls", async () => {
  const onCrumb = vi.fn();
  await renderIn("en", <TopBar crumbs={[{ label: "Demo", onClick: onCrumb }, { label: "The turn" }]} trailing={<button>Inbox</button>} />);
  const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
  fireEvent.click(within(nav).getByRole("button", { name: "Demo" }));
  expect(onCrumb).toHaveBeenCalled();
  expect(within(nav).getByText("The turn").getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("img", { name: "Human Harness" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Inbox" })).toBeTruthy();
});
```

Update the old "TopBar shows a title" test to pass `crumbs={[{ label: "Demo" }]}` and look for the breadcrumb instead of a heading. styles.test.ts:

```ts
it("keeps 80px for the traffic lights before the logo (spec §4.1)", () => {
  expect(css).toMatch(/^\.hh-topbar\s*{[^}]*padding:\s*0 20px 0 80px/m);
  expect(css).toMatch(/^\.hh-topbar\s*{[^}]*background:\s*var\(--hh-rail\)/m);
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**

```tsx
export interface Crumb { label: string; onClick?: () => void }

/** The window's top bar (UI refresh spec §4.1): the drag region of the hiddenInset title bar, 80px left for the traffic lights,
 * then the logo, the breadcrumb, the centre slot (search, when its spec ships: Q1) and the trailing controls. */
export function TopBar({ crumbs = [], logo, mock, center, trailing, children }: { crumbs?: Crumb[]; logo?: string; mock?: boolean; center?: ReactNode; trailing?: ReactNode; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <header className="hh-topbar">
      {logo ? <img className="hh-topbar-logo" src={logo} alt={t("app.name")} /> : <HHLogo className="hh-topbar-logo" title={t("app.name")} />}
      {crumbs.length > 0 && (
        <nav className="hh-crumbs" aria-label={t("app.breadcrumb")}>
          {crumbs.map((c, i) => (
            <Fragment key={i}>
              {i > 0 && <span aria-hidden="true" className="hh-crumb-sep">/</span>}
              {i === crumbs.length - 1 ? <span aria-current="page" className="hh-crumb-here">{c.label}</span> : <button className="hh-crumb" onClick={c.onClick}>{c.label}</button>}
            </Fragment>
          ))}
        </nav>
      )}
      {mock && <MockBadge />}
      <span className="hh-spacer">{center}</span>
      {trailing}
      {children}
    </header>
  );
}
```

en.json: `"app": { "name": "Human Harness", "breadcrumb": "Breadcrumb" }` (merge with existing `app` keys if any). `HHLogo` gets `role="img"` + `aria-label` when `title` is set (keep its existing test). styles.css replaces `.hh-topbar`:

```css
.hh-topbar { height: 64px; box-sizing: border-box; display: flex; align-items: center; gap: 14px; padding: 0 20px 0 80px; background: var(--hh-rail); border-bottom: 1px solid var(--hh-line); -webkit-app-region: drag; user-select: none; }
.hh-topbar-logo { width: 44px; height: 44px; border-radius: 12px; flex: none; }
.hh-crumbs { display: flex; align-items: center; gap: 6px; white-space: nowrap; min-width: 0; }
.hh-crumb { min-height: 32px; padding: 0 4px; border: 0; background: transparent; color: var(--hh-muted); }
.hh-crumb-sep { color: var(--hh-faint); }
.hh-crumb-here { font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
.hh-topbar .hh-spacer { display: flex; justify-content: center; }
```

- [ ] **Step 4: Run** → PASS (other tests that looked for the top-bar heading get the breadcrumb: fix their queries, not behavior).
- [ ] **Step 5: Commit** `git commit -am "feat(ui): top bar with logo and breadcrumb"`

### Task 8: `HarnessApp` places the shell

**Files:**
- Modify: `packages/ui/src/HarnessApp.tsx`, `packages/ui/src/styles.css`
- Test: `packages/ui/test/HarnessApp.test.tsx`

- [ ] **Step 1: Write the failing tests** (use the file's existing fake client and a configured state):

```tsx
it("wraps the chat in the shell: top bar, rail with Tasks current (spec §4)", async () => {
  await renderApp(configuredState());
  const rail = await screen.findByRole("navigation", { name: "App" });
  expect(within(rail).getByRole("button", { name: "Tasks" }).getAttribute("aria-current")).toBe("page");
  expect(within(rail).queryByRole("button", { name: "Inbox" })).toBeNull(); // no parallel: D0
});

it("Rail › Home goes to Home and Rail › Settings opens Settings", async () => {
  await renderApp(configuredState());
  fireEvent.click(await screen.findByRole("button", { name: "Home" }));
  expect(await screen.findByRole("button", { name: /Start/ })).toBeTruthy();
});
```

(`renderApp` / `configuredState` are the helpers the file already uses; if named differently, use those.)

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** In `HarnessApp`, around the chat branch (the one rendering `ChatView`, ~line 280):

```tsx
const entries = railEntries({
  parallel: Boolean(state.parallel),
  jobs: Boolean(state.parallel?.jobs?.length),
  notes: Boolean(state.notes),
  pluginPanels: Boolean(state.plugins?.some((p) => p.panels?.length)),
});
const pick = (e: RailEntry) => {
  if (e === "home") return goHome();
  if (e === "settings") return setSettings("general");
  if (e === "inbox" || e === "jobs") return setScreen({ kind: "inbox", column: e === "jobs" ? "jobs" : undefined });
  if (e === "notes") return openNotes();
  if (e === "plugins") return openPlugins();
  setScreen({ kind: "chat" });
};
return (
  <div className="hh-shell">
    <Rail entries={entries} current={railCurrent(screen)} onPick={pick} />
    <div className="hh-shell-main">{/* existing ChatView element */}</div>
  </div>
);
```

Use the existing state fields for `notes`/`plugins`/`jobs` (check `AppState` in `@humanharness/protocol`; adjust the three booleans to the real field names and note them in the PR). `goHome` is today's `onHome` handler; `openNotes` and `openPlugins` call into `ChatView` through two new optional props `notesRequest` / `pluginsRequest` (a counter that ChatView watches in a `useEffect` and opens the panel). `screen` is a new `useState<{ kind: "chat" } | { kind: "inbox"; column?: "jobs" }>({ kind: "chat" })` (Part 5 renders the inbox; until then `inbox` falls back to chat). The `TopBar` moves out of `ChatView` into `.hh-shell` above both columns in Task 9.

styles.css:

```css
.hh-shell { display: grid; grid-template-rows: auto 1fr; grid-template-columns: auto minmax(0, 1fr); height: 100%; }
.hh-shell > .hh-topbar { grid-column: 1 / -1; }
.hh-shell-main { min-width: 0; min-height: 0; display: flex; }
@media (max-width: 760px) { .hh-shell { grid-template-columns: minmax(0, 1fr); } }
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "feat(ui): shell around the chat: rail + main"`

### Task 9: Top bar content moves; Inbox pill, bell, avatar

**Files:**
- Modify: `packages/ui/src/HarnessApp.tsx`, `packages/ui/src/ChatView.tsx` (~1378–1418, the `<TopBar>` block), `packages/ui/src/parallel/Inbox.tsx`, `packages/ui/src/styles.css`
- Test: `packages/ui/test/HarnessApp.test.tsx`, `packages/ui/test/inbox.test.tsx`, `packages/ui/test/parallel-chat.test.tsx`

- [ ] **Step 1: Write the failing tests**

inbox.test.tsx:

```tsx
it("is a top-bar pill with the waiting count that opens the Inbox screen (spec §4.1)", async () => {
  const onOpen = vi.fn();
  await renderIn("en", <InboxPill tasks={tasksWith({ waiting: 2 })} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole("button", { name: "Inbox, 2 waiting" }));
  expect(onOpen).toHaveBeenCalled();
});
```

HarnessApp.test.tsx:

```tsx
it("leaves only logo, breadcrumb, Inbox, bell and avatar in the top bar (spec §4.1)", async () => {
  await renderApp(configuredState());
  const bar = (await screen.findByRole("navigation", { name: "Breadcrumb" })).closest("header")!;
  for (const gone of ["History", "Settings", "Home"]) expect(within(bar).queryByRole("button", { name: gone })).toBeNull();
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
  - Export `InboxPill` from `parallel/Inbox.tsx`: `<button className="hh-pill" aria-label={t("inbox.pill", { count })} onClick={onOpen}><InboxIcon />{t("inbox.title")}{count > 0 && <Tag tone="orange">{count}</Tag>}</button>`; `count` is the same `waiting.length + needsYou.length` the component computes today (extract it to `export function waitingCount(tasks, jobs)`). en.json `inbox.pill`: `"Inbox, {{count}} waiting"`.
  - `HarnessApp` renders `<TopBar crumbs={[{ label: state.harness.name, onClick: goHome }, { label: screenTitle }]} logo={state.harness.logo} mock={state.mock} trailing={<>{state.parallel && screen.kind !== "inbox" && <InboxPill … />}{attentionBell}{state.profiles && <ProfileAvatar … />}</>} />` above the rail. `screenTitle` is the focused task's title, else the harness's start-view title, else `t("rail.tasks")`.
  - `ProfileAvatar`: a 40px round button with the active profile's initial on its profile color (`--hh-profile-*`), opening the existing `ProfileSwitcher` as a popover. Not rendered without profiles (Q2).
  - `AttentionInbox` moves from ChatView's top bar to `trailing` unchanged; ChatView gets a new prop `attentionBell` removed — instead `HarnessApp` builds it from the same `attention` view it already passes down.
  - In `ChatView`, delete the `<TopBar …>…</TopBar>` block. Keep the elements it held in variables; Task 10 puts them in the task header. `slim` stays (it hides the task header instead).
  - The search trigger is **not** rendered (Q1). Leave `center` empty.
- [ ] **Step 4: Run** `corepack pnpm test` → PASS after fixing queries that found History/Settings in the top bar (they move in Task 10; until then, mount History from the task header placeholder `TaskHeader` created as a stub with only the History button so the history tests keep passing).
- [ ] **Step 5: e2e** `corepack pnpm e2e`; update selectors in `packages/e2e` that clicked the top-bar gear to click the rail's Settings (`getByRole("navigation", { name: "App" }).getByRole("button", { name: "Settings" })`).
- [ ] **Step 6: Commit** `git commit -am "feat(ui): top bar keeps logo, breadcrumb, Inbox, bell, avatar"` — Part 2 PR.

---

## Part 3 — Chat and start view (`feat/ui-chat`)

### Task 10: `TaskHeader`

**Files:**
- Create: `packages/ui/src/TaskHeader.tsx`
- Modify: `packages/ui/src/ChatView.tsx`, `packages/ui/src/chrome.tsx` (`SidekickToggle` as a pill), `styles.css`, en.json (`task.header.*`)
- Test: `packages/ui/test/task-header.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("shows title, where the task is, then context, usage, Sidekick, plugin chips, History and New task (spec §5.1)", async () => {
  const onHistory = vi.fn(), onNew = vi.fn();
  await renderIn("en", <TaskHeader title="The turn" subtitle="Topic 3 of 6 · started 12 min ago" meters={<span>meters</span>} sidekick={<button>Sidekick</button>} chips={null} onHistory={onHistory} onNewTask={onNew} />);
  expect(screen.getByRole("heading", { level: 1, name: "The turn" })).toBeTruthy();
  expect(screen.getByText("Topic 3 of 6 · started 12 min ago")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  fireEvent.click(screen.getByRole("button", { name: "New task" }));
  expect(onHistory).toHaveBeenCalled();
  expect(onNew).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "New task" }).className).toContain("hh-cta");
});
it("has no New task without onNewTask (plain mode, D0)", async () => {
  await renderIn("en", <TaskHeader title="Demo" onHistory={() => {}} />);
  expect(screen.queryByRole("button", { name: "New task" })).toBeNull();
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**

```tsx
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** The task's own header (UI refresh spec §5.1): what moved out of the top bar, next to the work it is about. */
export function TaskHeader({ title, subtitle, meters, sidekick, chips, onHistory, onNewTask }: {
  title: string; subtitle?: string; meters?: ReactNode; sidekick?: ReactNode; chips?: ReactNode; onHistory: () => void; onNewTask?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <header className="hh-task-head">
      <div className="hh-task-head-text">
        <h1 className="hh-task-title">{title}</h1>
        {subtitle && <span className="hh-caption">{subtitle}</span>}
      </div>
      {meters}
      {sidekick}
      {chips}
      <button className="hh-pill" onClick={onHistory}>{t("history.title")}</button>
      {onNewTask && <button className="hh-cta" onClick={onNewTask}>{t("task.header.new")}</button>}
    </header>
  );
}
```

en.json `"task": { "header": { "new": "New task", "topic": "Topic {{n}} of {{total}} · started {{ago}}" } }`. In `ChatView`, render `<TaskHeader>` at the top of the main column with `meters={<>{contextMeter}<UsageMeter … /></>}`, `sidekick={<SidekickToggle … />}`, `chips={<PluginChips … />}`, `onHistory` = the old History button handler, `onNewTask` = the task strip's new-task handler when `state.parallel`. `ContextMeter` renders as a pill: add `className="hh-pill"` and the label `t("context.pill", { pct })` = `"Context {{pct}}%"`. `SidekickToggle` becomes `<button className="hh-pill" aria-pressed={on}><span className="hh-dot" />{label}</button>`.

styles.css:

```css
.hh-task-head { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.hh-task-head-text { display: grid; gap: 2px; margin-right: auto; min-width: 0; }
.hh-task-title { font-size: 28px; font-weight: 600; letter-spacing: -0.5px; }
.hh-pill { min-height: 40px; padding: 0 14px; border-radius: 11px; }
.hh-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--hh-line-strong); }
[aria-pressed="true"] > .hh-dot { background: var(--hh-t-green-ink); }
```

- [ ] **Step 4: Run** `corepack pnpm test` → PASS (remove Task 9's stub). **Step 5: Commit** `git commit -am "feat(ui): task header"`

### Task 11: Task tabs and phases

**Files:** Modify `packages/ui/src/parallel/TaskStrip.tsx`, `packages/ui/src/PhaseStepper.tsx`, `styles.css`. Test `packages/ui/test/parallel-chat.test.tsx`, `packages/ui/test/phase-stepper.test.tsx`.

- [ ] **Step 1: Write the failing tests**

```tsx
it("TaskStrip is a tab per open task; a waiting one carries a dot named for screen readers (spec §5.1)", async () => {
  await renderIn("en", <TaskStrip state={state} tasks={tasksWith([{ id: "a", title: "The turn", focused: true }, { id: "b", title: "Engines", state: "waiting" }])} onNewTask={() => {}} onFocus={onFocus} />);
  const tabs = screen.getByRole("tablist", { name: "Open tasks" });
  expect(within(tabs).getByRole("tab", { name: "The turn" }).getAttribute("aria-selected")).toBe("true");
  expect(within(tabs).getByRole("tab", { name: "Engines, waiting for you" })).toBeTruthy();
  fireEvent.click(within(tabs).getByRole("tab", { name: "Engines, waiting for you" }));
  expect(onFocus).toHaveBeenCalledWith("b");
});
```

phase-stepper.test.tsx:

```tsx
it("draws done phases green, the current one orange, the rest as chips", async () => {
  await renderIn("en", <PhaseStepper phases={["Explore", "Decide", "Save note"]} current={1} />);
  expect(screen.getByText("Explore").className).toContain("hh-tag-green");
  expect(screen.getByText("Decide").className).toContain("hh-tag-orange");
  expect(screen.getByText("Save note").className).toContain("hh-chip");
});
```

(Adapt prop names to `PhaseStepper`'s real props; keep its existing aria.)

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `TaskStrip` gains `onFocus: (id: string) => void` (wire it to the same `client.tasks.focus(id)` the inbox row uses) and renders `<div role="tablist" aria-label={t("tasks.open")}>` with one `<button role="tab" aria-selected aria-label={waiting ? t("tasks.tabWaiting", { title }) : title}>` per open task, then the `PhaseStepper` on the right. `PhaseStepper` maps each phase to `<Tag tone="green">` (before current), `<Tag tone="orange">` with `aria-current="step"` (current), `<span className="hh-chip">` (after). Strings: `"tasks": { "open": "Open tasks", "tabWaiting": "{{title}}, waiting for you" }`.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "feat(ui): task tabs and phase tags"`

### Task 12: Flow side, choices, composer, Sidekick cards

**Files:** Modify `FlowSide.tsx`, `ChoicesBlock.tsx`, `ChatView.tsx` (composer), `sidekick/SidekickPanel.tsx`, `styles.css`. Tests: `flow-parts.test.tsx`, `choices.test.tsx`, `sidekick-panel.test.tsx` (existing file for the panel; create if missing).

- [ ] **Step 1: Write the failing tests**

```tsx
// flow-parts.test.tsx
it("marks done steps with a green Done tag and the current one with an orange Now tag, and counts them", async () => {
  await renderIn("en", <FlowSide {...flowProps({ done: ["The manifest", "Engines"], current: "The turn", next: ["Blocks"] })} />);
  expect(screen.getByText("2 / 4")).toBeTruthy();
  expect(within(screen.getByRole("button", { name: /The turn/ })).getByText("Now").className).toContain("hh-tag-orange");
  expect(within(screen.getByRole("button", { name: /Engines/ })).getByText("Done").className).toContain("hh-tag-green");
});
// choices.test.tsx
it("tags each option by its kind and outlines the recommended one", async () => {
  await renderChoices([{ label: "Go to Blocks", kind: "next", recommended: true }, { label: "Show the code", kind: "deeper" }, { label: "My own question", kind: "ask" }]);
  expect(within(screen.getByRole("button", { name: /Go to Blocks/ })).getByText("Next").className).toContain("hh-tag-orange");
  expect(screen.getByRole("button", { name: /Go to Blocks/ }).className).toContain("hh-choice-recommended");
});
// sidekick-panel.test.tsx
it("opens each card with its tag: Before you send orange, Next prompt blue, Worth knowing violet", async () => { /* render with one card of each moment; assert the three tag classes */ });
```

If `ChoicesBlock` options have no `kind` today, the tag is skipped (no new data); the test then only asserts the recommended outline, and the PR notes that `kind` tags need the blocks spec to carry it.

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the classes and tags. CSS:

```css
.hh-flow-side { width: 290px; padding: 28px 18px 28px 26px; gap: 26px; background: var(--hh-rail); }
.hh-flow-step { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 6px 10px; border-radius: 12px; border: 1px solid transparent; background: transparent; }
.hh-flow-step[aria-current="step"] { background: var(--hh-surface); border-color: var(--hh-line); font-weight: 600; }
.hh-flow-mark { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; background: var(--hh-surface-2); color: var(--hh-muted); font-size: 12.5px; }
.hh-flow-step.is-done .hh-flow-mark { background: var(--hh-t-green); color: var(--hh-t-green-ink); }
.hh-flow-step[aria-current="step"] .hh-flow-mark { background: var(--hh-cta); color: var(--hh-cta-ink); }
.hh-choice { width: 100%; min-height: 52px; justify-content: flex-start; gap: 12px; padding: 10px 14px; border-radius: 12px; text-align: left; }
.hh-choice-recommended { border-color: var(--hh-cta); box-shadow: inset 0 0 0 1px var(--hh-cta); }
.hh-composer { background: var(--hh-surface); border: 1px solid var(--hh-line); border-radius: 14px; box-shadow: var(--hh-shadow); padding: 12px 12px 12px 18px; display: grid; gap: 10px; }
.hh-side { width: auto; flex: 1 1 280px; max-width: 320px; padding: 24px 22px; background: var(--hh-rail); }
```

Composer: wrap the existing form in `.hh-composer`; Send gets `className="hh-cta"`; add `<span className="hh-caption">{t("chat.enterToSend")}</span>` (`"⏎ to send"`). Conversation: wrap the message list in `<section className="hh-card hh-conversation" aria-label={t("chat.conversation")}>`.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "feat(ui): flow side, choices, composer and Sidekick in the soft-cards look"`

### Task 13: Start view header and Cards / List

**Files:** Modify `packages/ui/src/StartView.tsx`, `styles.css`, en.json (`start.view.*`). Test `packages/ui/test/start-view.test.tsx` (create; move the start-view cases from `flow.test.tsx` only if they break).

- [ ] **Step 1: Write the failing test**

```tsx
it("switches between Cards and List and remembers the choice per harness (spec §5.3)", async () => {
  const store = new Map<string, string>();
  const props = startProps({ harnessId: "demo", storage: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v) } });
  const { unmount } = await renderIn("en", <StartView {...props} />);
  expect(screen.getByRole("button", { name: "Cards" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "List" }));
  expect(screen.getByRole("list", { name: "Guided path" }).className).toContain("hh-topics-list");
  unmount();
  await renderIn("en", <StartView {...props} />);
  expect(screen.getByRole("button", { name: "List" }).getAttribute("aria-pressed")).toBe("true");
});
it("tags each topic with its state and tier, and outlines the next one", async () => {
  await renderIn("en", <StartView {...startProps({ topics: [done("The manifest"), next("A turn end to end", "deep"), todo("Blocks")] })} />);
  expect(within(screen.getByRole("button", { name: /A turn end to end/ })).getByText("Up next").className).toContain("hh-tag-orange");
  expect(within(screen.getByRole("button", { name: /A turn end to end/ })).getByText("Deep").className).toContain("hh-tag-violet");
  expect(screen.getByText("2 / 6 done", { exact: false })).toBeTruthy();
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `StartView` gets an optional `storage` prop (default: a try/catch wrapper over `window.localStorage` with key `hh.start.view.<harnessId>`), a `Segmented` labelled `t("start.view.label")` with `cards` / `list`, and renders `<ol aria-label={t("start.view.path")} className={view === "list" ? "hh-topics hh-topics-list" : "hh-topics"}>`. Each topic button: `<Tag tone={done ? "green" : next ? "orange" : "gray"}>`, `<Tag tone={tier === "deep" ? "violet" : tier === "light" ? "green" : "blue"}>`, number `String(i + 1).padStart(2, "0")`. The next topic gets `hh-topic-next`. CSS:

```css
.hh-start-view { gap: 22px; padding: 28px 32px; max-width: 1080px; }
.hh-start-title { font-size: 28px; font-weight: 600; letter-spacing: -0.5px; }
.hh-topic { border-radius: 14px; border-color: var(--hh-line); background: var(--hh-surface); padding: 16px 18px; gap: 10px; }
.hh-topic-next { border-color: var(--hh-cta); box-shadow: inset 0 0 0 1px var(--hh-cta); }
.hh-topics-list { grid-template-columns: minmax(0, 1fr); }
.hh-topics-list .hh-topic { min-height: 52px; flex-direction: row; align-items: center; }
```

Strings: `"start": { "view": { "label": "View", "cards": "Cards", "list": "List", "path": "Guided path", "done": "{{done}} / {{total}} done", "askNow": "Or ask straight away", "upNext": "Up next", "toDo": "To do", "doneTag": "Done" } }`.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "feat(ui): start view header and Cards / List"`

### Task 14: Part 3 e2e and screenshots

- [ ] **Step 1:** `corepack pnpm e2e` → fix selectors only (History now in the task header, New task in the task header).
- [ ] **Step 2:** Add `packages/e2e/tests/look.spec.ts` with one test per theme that opens the demo chat and start view and saves `page.screenshot({ path: "test-results/look/<screen>-<theme>.png" })` using `page.emulateMedia({ colorScheme })`. No pixel assertions; the reviewer compares with the mockups by eye (spec §9).
- [ ] **Step 3: Commit** `git commit -am "test(e2e): look screenshots for chat and start view"` — Part 3 PR with the screenshots attached.

---

## Part 4 — Home (`feat/ui-home`)

### Task 15: `PickUp` — "Pick up where you left"

**Files:** Create `packages/ui/src/PickUp.tsx`. Test `packages/ui/test/pick-up.test.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
import { pickUpItems } from "../src/PickUp";

it("takes open tasks first (waiting before working), then history, at most three (spec §5.2)", () => {
  const items = pickUpItems({
    open: [{ id: "a", title: "Engines", state: "working", updatedAt: 2 }, { id: "b", title: "The turn", state: "waiting", updatedAt: 1 }],
    history: [{ id: "c", title: "The manifest", outcome: "noteSaved", endedAt: 0 }, { id: "d", title: "Old", outcome: "noteSaved", endedAt: -1 }],
  });
  expect(items.map((i) => [i.title, i.tone])).toEqual([["The turn", "orange"], ["Engines", "blue"], ["The manifest", "green"]]);
});
it("is empty with nothing to pick up", () => {
  expect(pickUpItems({ open: [], history: [] })).toEqual([]);
});
it("renders nothing when empty, else a titled section with a count", async () => {
  const { container } = await renderIn("en", <PickUp items={[]} onOpen={() => {}} />);
  expect(container.innerHTML).toBe("");
  cleanup();
  await renderIn("en", <PickUp items={[{ id: "b", title: "The turn", tone: "orange", status: "Waiting for you", where: "Topic 3 of 6 · 12 min ago" }]} onOpen={onOpen} />);
  expect(screen.getByRole("heading", { name: "Pick up where you left" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /The turn/ }));
  expect(onOpen).toHaveBeenCalledWith("b");
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**

```tsx
import { useTranslation } from "react-i18next";
import { Tag, type TagTone } from "./chrome";

export interface PickUpItem { id: string; title: string; tone: TagTone; status: string; where: string }
interface OpenTask { id: string; title: string; state: "waiting" | "working" | "queued"; updatedAt: number }
interface PastTask { id: string; title: string; outcome: "noteSaved" | "inProgress"; endedAt: number }

const RANK = { waiting: 0, working: 1, queued: 2 } as const;

/** Up to three tasks to resume (UI refresh spec §5.2): open ones first (waiting, working, queued), then the latest from history. */
export function pickUpItems({ open, history }: { open: OpenTask[]; history: PastTask[] }): PickUpItem[] {
  const fromOpen = [...open].sort((a, b) => RANK[a.state] - RANK[b.state] || b.updatedAt - a.updatedAt)
    .map((o) => ({ id: o.id, title: o.title, tone: (o.state === "waiting" ? "orange" : o.state === "working" ? "blue" : "gray") as TagTone, status: o.state, where: "" }));
  const seen = new Set(fromOpen.map((i) => i.id));
  const fromHistory = [...history].sort((a, b) => b.endedAt - a.endedAt).filter((h) => !seen.has(h.id))
    .map((h) => ({ id: h.id, title: h.title, tone: (h.outcome === "noteSaved" ? "green" : "blue") as TagTone, status: h.outcome, where: "" }));
  return [...fromOpen, ...fromHistory].slice(0, 3);
}

export function PickUp({ items, onOpen }: { items: PickUpItem[]; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <section className="hh-pickup" aria-labelledby="hh-pickup-h">
      <div className="hh-pickup-head"><h2 id="hh-pickup-h">{t("home.pickUp")}</h2><span className="hh-tag hh-tag-gray">{items.length}</span></div>
      <div className="hh-pickup-grid">
        {items.map((i) => (
          <button key={i.id} className="hh-pickup-card" onClick={() => onOpen(i.id)}>
            <Tag tone={i.tone}>{i.status}</Tag>
            <span className="hh-pickup-title">{i.title}</span>
            <span className="hh-caption">{i.where}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
```

`status` holds the raw state here (`waiting`, `noteSaved`…) and `where` is empty; `Home` replaces both with translated text (Task 16). CSS: `.hh-pickup-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; } .hh-pickup-card { flex-direction: column; align-items: flex-start; gap: 10px; padding: 16px 18px; border-radius: 14px; min-height: 44px; text-align: left; }`.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "feat(ui): Pick up where you left"`

### Task 16: Home look and wiring

**Files:** Modify `packages/ui/src/Home.tsx`, `styles.css`, en.json (`home.pickUp`, `home.engine.*`). Test `packages/ui/test/home.test.tsx`.

- [ ] **Step 1: Write the failing tests**

```tsx
it("shows Pick up on a ready Home and hides it when setup is missing (spec §5.2)", async () => {
  await renderHome(readyState(), { pickUp: [item("The turn")] });
  expect(await screen.findByRole("heading", { name: "Pick up where you left" })).toBeTruthy();
  cleanup();
  await renderHome(notConfiguredState(), { pickUp: [item("The turn")] });
  expect(screen.queryByRole("heading", { name: "Pick up where you left" })).toBeNull();
});
it("the engine pill says who is connected and the 5-hour use, and opens Settings › Engine", async () => {
  const onEngine = vi.fn();
  await renderHome(readyState({ limits: [{ window: "5h", used: 0.18 }] }), { onEngine });
  fireEvent.click(screen.getByRole("button", { name: /Claude Code, connected/ }));
  expect(onEngine).toHaveBeenCalled();
});
it("Start is the amber CTA", async () => {
  await renderHome(readyState());
  expect(screen.getByRole("button", { name: /Start Demo/ }).className).toContain("hh-start");
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `Home` reads open tasks with `useTasks(client, Boolean(state.parallel))` and, without `parallel`, the last history groups through the call `HistoryPanel` already uses (`client.history.list()` or its real name), maps them with `pickUpItems`, fills `status` (`t("home.status.waiting")` …) and `where` (`t("task.header.topic", …)` or `t("home.noteSavedAgo", { ago })`), and renders `<PickUp>` under the engine pill only when the existing "ready" condition (set up, engine connected, Start offered) holds. `onOpen(id)` focuses the task (`client.tasks.focus`) or, for a history item, opens History at it. Engine pill: `aria-label={t("home.engine.pill", { engine, pct })}` = `"{{engine}}, connected. 5-hour usage {{pct}}%. Open engine settings"`. CSS per mockup: `.hh-home-logo { width: 84px; height: 84px; border-radius: 24px; box-shadow: var(--hh-shadow); } .hh-home-name { font-size: 40px; font-weight: 600; letter-spacing: -1px; } .hh-home-main { max-width: 760px; gap: 28px; padding: 40px 16px 32px; } .hh-footer { background: var(--hh-rail); border-top: 1px solid var(--hh-line); }`. Missing-setup sections, language offer and backup notice get `hh-card`.
- [ ] **Step 4: Run** `corepack pnpm test && corepack pnpm e2e` → PASS; add Home to `look.spec.ts`.
- [ ] **Step 5: Commit** `git commit -am "feat(ui): Home look, engine pill, Pick up"` — Part 4 PR.

---

## Part 5 — Inbox board (`feat/ui-inbox`)

### Task 17: Board model

**Files:** Create `packages/ui/src/parallel/board.ts`. Test `packages/ui/test/inbox-board.test.tsx`.

- [ ] **Step 1: Write the failing test**

```ts
import { boardColumns } from "../src/parallel/board";

it("splits tasks into Waiting for you, Working, Queued and adds Jobs (spec §5.4)", () => {
  const cols = boardColumns({
    tasks: [{ id: "a", state: "waiting" }, { id: "b", state: "running" }, { id: "c", state: "queued" }, { id: "d", state: "waiting" }],
    jobs: [{ id: "j1" }, { id: "j2" }],
  });
  expect(cols.map((c) => [c.id, c.tone, c.items.length])).toEqual([["waiting", "orange", 2], ["working", "blue", 1], ["queued", "gray", 1], ["jobs", "violet", 2]]);
});
it("has no Jobs column for a harness without jobs", () => {
  expect(boardColumns({ tasks: [], jobs: null }).map((c) => c.id)).toEqual(["waiting", "working", "queued"]);
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** with the same filters `Inbox.tsx` uses today (`WORKING` states list: import it from `Inbox.tsx` after exporting it):

```ts
import type { TagTone } from "../chrome";
import { WORKING } from "./Inbox";

export interface BoardColumn<T> { id: "waiting" | "working" | "queued" | "jobs"; tone: TagTone; items: T[] }

/** The Inbox board's columns (UI refresh spec §5.4), from the same task states the list uses. */
export function boardColumns<T extends { state: string }, J>({ tasks, jobs }: { tasks: T[]; jobs: J[] | null }): BoardColumn<T | J>[] {
  const cols: BoardColumn<T | J>[] = [
    { id: "waiting", tone: "orange", items: tasks.filter((t) => t.state === "waiting") },
    { id: "working", tone: "blue", items: tasks.filter((t) => WORKING.includes(t.state as never)) },
    { id: "queued", tone: "gray", items: tasks.filter((t) => t.state === "queued") },
  ];
  if (jobs) cols.push({ id: "jobs", tone: "violet", items: jobs });
  return cols;
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "feat(ui): inbox board columns"`

### Task 18: `InboxBoard` screen

**Files:** Create `packages/ui/src/parallel/InboxBoard.tsx`; modify `parallel/Inbox.tsx` (export its row actions), `HarnessApp.tsx` (`screen.kind === "inbox"`), `styles.css`, en.json (`inbox.board.*`). Test `packages/ui/test/inbox-board.test.tsx`.

- [ ] **Step 1: Write the failing tests**

```tsx
it("shows the summary line, a List / Board switch (Board first) and New task", async () => {
  await renderBoard({ tasks: [waiting("The turn"), waiting("Engines"), running("Blocks")], jobs: [job("Sync"), job("Daily"), job("Link")] });
  expect(screen.getByRole("heading", { level: 1, name: "Inbox" })).toBeTruthy();
  expect(screen.getByText("2 waiting for you · 1 working · 3 jobs")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Board" }).getAttribute("aria-pressed")).toBe("true");
});
it("a task card opens the task; a job card's one action runs it", async () => {
  const { client } = await renderBoard({ tasks: [waiting("The turn")], jobs: [job("Sync", { manual: true })] });
  fireEvent.click(screen.getByRole("button", { name: /The turn/ }));
  expect(client.tasks.focus).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Run now" }));
  expect(client.jobs.run).toHaveBeenCalled();
});
it("List shows today's four sections", async () => {
  await renderBoard({ tasks: [waiting("The turn")], jobs: [] });
  fireEvent.click(screen.getByRole("button", { name: "List" }));
  expect(screen.getByRole("region", { name: "Waiting for you" })).toBeTruthy();
});
it("Rail › Jobs scrolls to the Jobs column", async () => {
  await renderBoard({ tasks: [], jobs: [job("Sync")], column: "jobs" });
  expect(document.activeElement?.closest("section")?.getAttribute("aria-labelledby")).toContain("jobs");
});
```

(`renderBoard` builds the fake client with `tasks` / `jobs` and renders `InboxBoard`; reuse `inbox.test.tsx`'s fixtures. Use the real method names of `client.tasks` / `client.jobs` from that file.)

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `InboxBoard({ client, state, tasks, column, onNewTask, onOpened })`: uses `useJobs(client, …)` as `JobsTab` does, `boardColumns`, a `Segmented` (`board` default, Q5), and per column a `<section className="hh-board-col" aria-labelledby>` headed by `<h2><Tag tone>…</Tag></h2>` and a gray count tag. Task card: title; reason tag (`Your turn` orange / `Has a question` blue) and the phase chip; working tasks show the activity chip and `<div role="img" aria-label={t("inbox.board.progress")} className="hh-progress">`; queued tasks show `t("inbox.board.startsWhen", { cap })`; footer: tier tag + `t("inbox.board.waitingFor", { ago })`. The same-files conflict notice renders as a dashed `hh-board-note` card in Working. Job card: name, result tag, `t("inbox.board.jobSchedule", …)`, one pill: `Run now` (manual), `Open` (needs you), `Resume` (paused). The List view renders the existing four-section list component (extract the inner list of `Inbox.tsx` into `InboxList` and use it in both places). `HarnessApp` renders `<InboxBoard>` in `.hh-shell-main` when `screen.kind === "inbox"`; opening a task sets `screen` back to `chat`. CSS:

```css
.hh-board { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 14px; }
.hh-board-col { flex: 1 1 250px; min-width: 0; display: grid; gap: 10px; padding: 12px; border-radius: 16px; background: var(--hh-column); border: 1px solid var(--hh-line); }
.hh-board-card { display: grid; gap: 10px; padding: 14px 16px; border-radius: 13px; border: 1px solid var(--hh-line); background: var(--hh-surface); text-align: left; height: auto; justify-content: stretch; }
.hh-board-card:hover { border-color: var(--hh-line-strong); box-shadow: var(--hh-shadow); }
.hh-board-note { border-style: dashed; background: transparent; color: var(--hh-t-red-ink); }
.hh-progress { height: 6px; border-radius: 3px; background: var(--hh-surface-2); overflow: hidden; }
.hh-progress > i { display: block; height: 100%; background: var(--hh-t-blue-ink); }
```

Strings (`inbox.board`): `"title": "Inbox"`, `"summary": "{{waiting}} waiting for you · {{working}} working · {{jobs}} jobs"`, `"list": "List"`, `"board": "Board"`, `"waiting": "Waiting for you"`, `"working": "Working"`, `"queued": "Queued"`, `"jobs": "Jobs"`, `"yourTurn": "Your turn"`, `"hasQuestion": "Has a question"`, `"startsWhen": "Starts when a slot frees up · {{cap}} tasks at once"`, `"waitingFor": "Waiting {{ago}}"`, `"jobSchedule": "{{every}} · Last run {{last}} · Next run {{next}}"`, `"runNow": "Run now"`, `"open": "Open"`, `"resume": "Resume"`.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "feat(ui): Inbox board screen"`

### Task 19: Remove the drop-down; e2e

- [ ] **Step 1:** Delete the drop-down popover from `Inbox.tsx` (the top-bar part is now `InboxPill`; the list is `InboxList`). Update `inbox.test.tsx` cases that opened the drop-down to open the screen through `InboxPill` → `InboxBoard` → List.
- [ ] **Step 2:** `corepack pnpm test && corepack pnpm e2e` → PASS (e2e parallel flows click the Inbox pill, then a card). Add Inbox to `look.spec.ts`.
- [ ] **Step 3: Commit** `git commit -am "refactor(ui): inbox lives on its own screen"` — Part 5 PR.

---

## Part 6 — Settings page (`feat/ui-settings`)

### Task 20: `SettingsSheet` → `SettingsPage`

**Files:** Rename `packages/ui/src/SettingsSheet.tsx` → `SettingsPage.tsx` (`git mv`), update imports (`HarnessApp.tsx`, `index.ts`, tests). Modify `styles.css`. Test `packages/ui/test/settings.test.tsx`.

- [ ] **Step 1: Write the failing tests**

```tsx
it("is a full page: breadcrumb Demo / Settings / Models, a section list, and Done (spec §5.5)", async () => {
  await renderSettings({ tab: "models" });
  expect(screen.queryByRole("dialog")).toBeNull();
  const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
  expect(within(crumbs).getByText("Models").getAttribute("aria-current")).toBe("page");
  const nav = screen.getByRole("navigation", { name: "Settings sections" });
  expect(within(nav).getByRole("button", { name: "Models" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("button", { name: "Done" }).className).toContain("hh-cta");
});
it("Done and Escape go back to where the person was", async () => {
  const onClose = vi.fn();
  await renderSettings({ tab: "general", onClose });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(2);
});
it("a section that needs attention carries an orange count", async () => {
  await renderSettings({ tab: "general", pluginsNeedingReview: 1 });
  expect(within(screen.getByRole("button", { name: /Plugins/ })).getByText("1").className).toContain("hh-tag-orange");
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Keep `TABS`, the tab gating and every tab component call unchanged. Replace the backdrop + `role="dialog"` wrapper with:

```tsx
<div className="hh-settings-page">
  <TopBar crumbs={[{ label: state.harness.name, onClick: onClose }, { label: t("settings.title"), onClick: () => onTab("general") }, { label: tabLabel(tab) }]} trailing={<button className="hh-cta" onClick={onClose}>{t("settings.done")}</button>} />
  <div className="hh-settings-body">
    <nav className="hh-settings-nav" aria-label={t("settings.sections")}>
      <h1>{t("settings.title")}</h1>
      {tabs.map((id) => (
        <button key={id} className="hh-settings-navitem" aria-current={id === tab ? "page" : undefined} onClick={() => onTab(id)}>
          {tabLabel(id)}{attention[id] ? <Tag tone="orange">{attention[id]}</Tag> : null}
        </button>
      ))}
    </nav>
    <main className="hh-settings-main">{/* the existing tab bodies */}</main>
  </div>
</div>
```

Escape: keep the existing keydown handler, calling `onClose`. Focus moves to the `h1` on open and back to the rail's Settings button on close (the existing focus-return code, retargeted). `attention.plugins` = count of plugins whose status is "needs review" or "turned off after crashes" (from `usePlugins`, already loaded by `PluginsTab`; lift the hook to the page). `HarnessApp` renders `SettingsPage` in place of the shell's main area (`screen.kind === "settings"` replaces the `settings` state's overlay use: keep `settings: SettingsTab | null` and render the page instead of the shell when it is not null). Strings: `"settings": { "done": "Done", "sections": "Settings sections" }`. CSS:

```css
.hh-settings-page { display: grid; grid-template-rows: auto 1fr; height: 100%; }
.hh-settings-body { display: grid; grid-template-columns: 240px minmax(0, 1fr); min-height: 0; }
.hh-settings-nav { display: grid; align-content: start; gap: 2px; padding: 24px 14px; background: var(--hh-rail); border-right: 1px solid var(--hh-line); overflow-y: auto; }
.hh-settings-nav h1 { font-size: 20px; font-weight: 600; padding: 0 10px 10px; }
.hh-settings-navitem { justify-content: space-between; min-height: 40px; border: 0; background: transparent; border-radius: 10px; }
.hh-settings-navitem[aria-current="page"] { background: var(--hh-active); color: var(--hh-active-ink); font-weight: 600; }
.hh-settings-main { overflow-y: auto; padding: 28px 32px 48px; }
.hh-settings-main > * { max-width: 860px; }
@media (max-width: 760px) { .hh-settings-body { grid-template-columns: minmax(0, 1fr); } .hh-settings-nav { grid-auto-flow: column; overflow-x: auto; } }
```

Delete `.hh-sheet*` rules.
- [ ] **Step 4: Run** `corepack pnpm test` → PASS (settings tests that queried `getByRole("dialog")` now query the page; behavior unchanged).
- [ ] **Step 5: Commit** `git commit -am "feat(ui): Settings is a page"`

### Task 21: Section frame and rows

**Files:** Create `packages/ui/src/settings-parts.tsx` (`SectionHead`, `SettingsCard`, `SettingRow`). Modify every tab (`GeneralTab` in `SettingsPage.tsx`, `HarnessSettingsTab.tsx`, `EngineTab.tsx`, `ModelsTab.tsx`, `sidekick/SidekickTab.tsx`, `plugins/PluginsTab.tsx`, `connections/ConnectionsTab.tsx`, `parallel/JobsTab.tsx`, `UsageTab.tsx`) to open with `SectionHead`. Test `packages/ui/test/settings-parts.test.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
it("a section opens with its title and one line on what it is for", async () => {
  await renderIn("en", <SectionHead title="Models" line="Choose how much power each task uses. Changes apply from the next task." />);
  expect(screen.getByRole("heading", { level: 2, name: "Models" })).toBeTruthy();
  expect(screen.getByText(/Changes apply from the next task/)).toBeTruthy();
});
it("a row puts label and hint left, control right", async () => {
  await renderIn("en", <SettingRow label="Before you send" hint="Review prompts before they go out."><button role="switch" aria-checked="true" aria-label="Before you send" /></SettingRow>);
  expect(screen.getByText("Review prompts before they go out.").className).toContain("hh-caption");
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**

```tsx
import type { ReactNode } from "react";

/** A Settings section's head (UI refresh spec §5.5): title, what it is for and when a change applies, and an optional control. */
export function SectionHead({ title, line, aside }: { title: string; line: string; aside?: ReactNode }) {
  return (
    <header className="hh-section-head">
      <div><h2>{title}</h2><p className="hh-caption">{line}</p></div>
      {aside}
    </header>
  );
}
export function SettingsCard({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="hh-card hh-settings-card">
      {(title || actions) && <div className="hh-settings-card-head">{title && <h3>{title}</h3>}<span className="hh-spacer" />{actions}</div>}
      {children}
    </section>
  );
}
export function SettingRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="hh-setting-row">
      <div className="hh-setting-text"><span>{label}</span>{hint && <span className="hh-caption">{hint}</span>}</div>
      {children}
    </div>
  );
}
```

CSS: `.hh-section-head { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 12px; margin-bottom: 18px; } .hh-section-head h2 { font-size: 28px; font-weight: 600; letter-spacing: -0.5px; } .hh-settings-card { padding: 18px 20px; display: grid; gap: 4px; margin-bottom: 16px; } .hh-setting-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; min-height: 52px; padding: 8px 0; border-top: 1px solid var(--hh-line); } .hh-setting-row:first-of-type { border-top: 0; } .hh-setting-text { flex: 1 1 240px; display: grid; gap: 2px; }`. Section lines (en.json `settings.line.*`) — copy from the spec §5.5 and mockups: models "Choose how much power each task uses. More power gives better answers but uses more of your plan. Changes apply from the next task.", sidekick "Reads your prompt before it goes out and suggests a clearer one.", plugins "Plugins bring information from outside into this app. Each one shows what it may reach before it runs.", engine "{{name}} works with an AI plan you already have, using your own account.", connections "Keys this app uses to reach your services. They are stored encrypted on this computer and never shown again.", usage "{{engine}} reports it with every reply.", general/harness/jobs: write one line each in the same pattern and list them in the PR.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "feat(ui): settings section frame and rows"`

### Task 22: Section bodies per mockup

One step per tab; each keeps its data and actions and only changes layout and tags. Test each in its existing test file with one assertion on the new element.

- [ ] **Models** (`models-tab.test.tsx`): `it("shows Changed · recommended in orange with Restore on a changed task")` — render a task whose level differs from the recommendation; expect text `"Changed · recommended: Standard"` and a `Restore` button. Implement: rows in `SettingsCard title="Tasks"` with `Segmented` Light/Standard/Deep/Custom; Levels card with an engine `Segmented` and a table (level `Tag` green/blue/violet, model, effort, used by, Edit); the line "If your plan doesn't include a model, the task uses the level below and tells you."; the pinned files budget select in its own card.
- [ ] **Sidekick** (`sidekick-tab.test.tsx` or the existing Sidekick settings test): `it("puts the main switch in the head and three stats on top")` — expect `getByRole("switch", { name: "Sidekick" })` inside the section head and texts "This week", "Suggestions used", "Model". Implement with `SectionHead aside={switch}`, a `.hh-stats` grid of three `hh-card`s, the existing switches in `SettingRow`s, `LearnedList` items with a kind `Tag` (Style blue, Habit orange, Level violet) plus Edit and Forget this.
- [ ] **Plugins** (`plugins-tab.test.tsx`): `it("is a list with the selected plugin's detail beside it")` — expect `getByRole("list")` and the detail heading of the first plugin. Implement: `.hh-master-detail { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 16px; }` (one column under 760px); status `Tag` (On green, Needs review orange, Turned off after crashes red); `PluginDetail` rows via `SettingRow`; Remove… as `hh-danger` (`color: var(--hh-t-red-ink)`).
- [ ] **Engine** (`engine-tab.test.tsx`): `it("shows the engine in use as a card and the others with what they need and the next step")`. Implement: current engine card with `In use` and `Ready ✓` green tags and rows; `Other engines` grid of cards with the requirement line, the state line (copy rule, Part 8 checks it) and `Use <engine>`.
- [ ] **Connections** (`connections-ui.test.tsx`): `it("an unset key shows a password field and Save")`. Implement rows with a letter tile, name, "Used by …", state `Tag` and Test / Replace, or `SecretField` + `hh-cta` Save.
- [ ] **Usage** (`usage-tab.test.tsx` or existing): `it("tags a window past 75% as Close to your limit")`. Implement: one card per window with percent, `.hh-progress`, the tag when `used >= 0.75`, and "Renews …"; topic table with a use `Tag` (Low green, Medium blue, High orange), share and "Enough for".
- [ ] **General, harness tab, Jobs:** wrap their existing content in `SectionHead` + `SettingsCard` + `SettingRow`; no new assertions beyond Task 21.
- [ ] **Run** `corepack pnpm test` → PASS. **Commit** `git commit -am "feat(ui): settings sections in the soft-cards look"`

### Task 23: Part 6 e2e

- [ ] `corepack pnpm e2e` — settings flows open Settings from the rail and close with Done; add Settings › Models and › Usage to `look.spec.ts`. **Commit** `git commit -am "test(e2e): settings page"` — Part 6 PR.

---

## Part 7 — Drawers and setup (`feat/ui-panels`)

### Task 24: `Drawer`

**Files:** Create `packages/ui/src/Drawer.tsx`. Test `packages/ui/test/drawer.test.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
it("is a right-side dialog with a title, one subtitle line and Close; Escape and the scrim close it (spec §5.7)", async () => {
  const onClose = vi.fn();
  await renderIn("en", <Drawer title="History" subtitle="Go back to any point: your files return to how they were then." onClose={onClose}><p>body</p></Drawer>);
  const dlg = screen.getByRole("dialog", { name: "History" });
  expect(dlg.getAttribute("aria-modal")).toBe("true");
  fireEvent.keyDown(dlg, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(document.querySelector(".hh-drawer-scrim")!);
  expect(onClose).toHaveBeenCalledTimes(3);
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**

```tsx
import { type ReactNode, useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";

/** A drawer from the right (UI refresh spec §5.7): one at a time, on the rail's ground, over a scrim. */
export function Drawer({ title, subtitle, actions, wide = false, onClose, children }: { title: string; subtitle?: string; actions?: ReactNode; wide?: boolean; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="hh-drawer-layer">
      <div className="hh-drawer-scrim" onClick={onClose} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={id} className={wide ? "hh-drawer hh-drawer-wide" : "hh-drawer"}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
        <header className="hh-drawer-head">
          <div className="hh-drawer-titles"><h2 id={id}>{title}</h2>{subtitle && <span className="hh-caption">{subtitle}</span>}</div>
          {actions}
          <button className="hh-icon-button" aria-label={t("panel.close")} onClick={onClose}>✕</button>
        </header>
        <div className="hh-drawer-body">{children}</div>
      </div>
    </div>
  );
}
```

CSS:

```css
.hh-drawer-layer { position: fixed; inset: 64px 0 0 0; z-index: 20; display: flex; justify-content: flex-end; }
.hh-drawer-scrim { position: absolute; inset: 0; background: var(--hh-backdrop); }
.hh-drawer { position: relative; width: min(480px, 100%); height: 100%; display: flex; flex-direction: column; background: var(--hh-rail); border-left: 1px solid var(--hh-line); box-shadow: -16px 0 48px rgba(0, 0, 0, 0.14); outline: none; }
.hh-drawer-wide { width: min(760px, 100%); }
.hh-drawer-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 18px 20px; border-bottom: 1px solid var(--hh-line); }
.hh-drawer-titles { flex: 1 1 auto; min-width: 0; display: grid; gap: 2px; }
.hh-drawer-head h2 { font-size: 20px; font-weight: 600; letter-spacing: -0.3px; }
.hh-drawer-body { flex: 1 1 auto; overflow: auto; padding: 16px 20px; display: grid; align-content: start; gap: 14px; }
```

`panel.close`: reuse the existing close string if one exists.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "feat(ui): drawer frame"`

### Task 25: History, Notes, Context and file timeline in the drawer

**Files:** Modify `HistoryPanel.tsx`, `NotesPanel.tsx`, `ContextPanel.tsx`, `FileTimelinePanel.tsx`, `ChatView.tsx` (they are mounted ~1895–1940), `styles.css`, en.json. Tests: `history-panel.test.tsx`, `notes-panel.test.tsx`, `context-panel.test.tsx`, `file-timeline-panel.test.tsx`.

- [ ] **Step 1: Write the failing tests**

```tsx
// history-panel.test.tsx
it("is a drawer with the go-back subtitle and an All / Tasks / Outside a task filter (spec §5.7)", async () => {
  await renderHistory(historyWith([task("The turn"), outside("A question")]));
  expect(screen.getByRole("dialog", { name: "History" })).toBeTruthy();
  expect(screen.getByText("Go back to any point: your files return to how they were then.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Outside a task" }));
  expect(screen.queryByText("The turn")).toBeNull();
  expect(screen.getByText("No changes").className).toContain("hh-tag-gray");
});
// notes-panel.test.tsx
it("titles itself What's clear so far, counts topics, and gives each note its two actions", async () => {
  await renderNotes([note("Engines", 3), note("The manifest", 4)]);
  expect(screen.getByRole("dialog", { name: "What's clear so far" })).toBeTruthy();
  expect(screen.getByText("2 topics summarized")).toBeTruthy();
  expect(screen.getByText("3 key points").className).toContain("hh-tag-blue");
});
```

Context and file timeline: one assertion each that they render inside `getByRole("dialog")`.

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Each panel's root becomes `<Drawer title subtitle onClose>`; their inner lists keep their logic. History: the filter is a `Segmented` over the groups already computed (`byDay` keeps working on the filtered list: `all`, groups with a task id, groups without); each task group is an `hh-card` with a status `Tag` (In progress blue / Note saved green), time span, files changed, file chips, "Undo this task"; points get `.hh-history-dot` (green for "The AI finished"); "No changes" is `<Tag tone="gray">`. Notes: a green note line on top (`t("notes.why")` = "The next question starts from your summaries instead of re-reading the code."), each note an `hh-card` with `Tag tone="blue"` key-point count and two pills; muted footer `t("notes.where")`. Delete `.hh-history { position: fixed … }` and the other panels' own frame rules. Strings: `history.subtitle`, `history.filter.{all,tasks,outside}`, `history.noChanges`, `notes.title` = "What's clear so far", `notes.count` = "{{count}} topics summarized", `notes.keyPoints` = "{{count}} key points", `notes.pickUp`, `notes.openFile`, `notes.why`, `notes.where`.
- [ ] **Step 4: Run** `corepack pnpm test` → PASS. **Step 5: Commit** `git commit -am "feat(ui): history, notes, context and timeline as drawers"`

### Task 26: Reader stays docked, new look (Q3)

**Files:** Modify `DocumentReader.tsx`, `styles.css`. Test `document-reader.test.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
it("shows the document's tags on top and Source / Show chat in its footer (spec §5.7)", async () => {
  await renderReader(doc({ title: "A turn end to end", status: "Updated", path: "notes/turn.md" }));
  expect(screen.getByText("Updated").className).toContain("hh-tag-green");
  expect(screen.getByRole("button", { name: "Source" })).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull(); // docked, not a drawer (Q3)
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Keep `hh-reader` docking and full screen. Header: title + `t("reader.subtitle", { path })` ("Document · {{path}}"), `Aa` (the existing prefs toggle) and Full screen as pills. Meta chips become tags: status green, read time and author gray. Footer `.hh-reader-foot` with path + change time, Source and Show chat pills (Show chat = the existing "back to chat"/close-full action). Decision callout uses `--hh-t-violet` / `-ink`. CSS: `.hh-reader { background: var(--hh-surface); } .hh-reader-bar { padding: 18px 20px; background: var(--hh-rail); } .hh-reader-doc { font-size: 16px; line-height: 1.65; max-width: 680px; } .hh-reader-foot { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 12px 20px; border-top: 1px solid var(--hh-line); background: var(--hh-rail); }`.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "feat(ui): reader in the new look, still docked"`

### Task 27: Setup frame and engine tiles

**Files:** Modify `SetupFlow.tsx`, `EngineOnboarding.tsx`, `styles.css`. Tests `setup-flow.test.tsx`, `setup-connect.test.tsx`.

- [ ] **Step 1: Write the failing tests**

```tsx
it("lists the steps on the left, done ones with their value, and says Step 2 of 2 on the current one", async () => {
  await renderSetup({ at: "engine", folder: "~/Documents/Demo" });
  const steps = screen.getByRole("navigation", { name: "Steps" });
  expect(within(steps).getByText("~/Documents/Demo")).toBeTruthy();
  expect(within(steps).getByText("Step 2 of 2")).toBeTruthy();
});
it("shows engines as radio tiles with what they need and the next step", async () => {
  await renderSetup({ at: "engine", engines: [ready("claude"), missing("codex")] });
  const group = screen.getByRole("radiogroup", { name: "AI engines" });
  expect(within(group).getByRole("radio", { name: /Claude Code/ }).getAttribute("aria-checked")).toBe("true");
  expect(within(group).getByText("Not on this computer yet · we install it next")).toBeTruthy();
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `SetupFlow`: header (logo, `t("setup.title", { name })`, Cancel pill), `.hh-setup-body { display: grid; grid-template-columns: 260px minmax(0, 1fr); }` with the step `nav` (done steps: green ✓ mark + value; current: `aria-current="step"` + "Step n of m"). `EngineOnboarding`: the engine list becomes `role="radiogroup"` of `role="radio"` tiles (logo tile, name, maker, requirement, status line with dot); selected tile `border-color: var(--hh-cta); box-shadow: inset 0 0 0 1px var(--hh-cta)`; the check block becomes the "One last check" card; footer with the reassurance line, Back pill, Next `hh-cta`. If the step was a list of buttons, keep each button's handler on the radio's click and add arrow-key movement inside the group.
- [ ] **Step 4: Run** `corepack pnpm test && corepack pnpm e2e` → PASS; add Setup and the History drawer to `look.spec.ts`.
- [ ] **Step 5: Commit** `git commit -am "feat(ui): setup frame and engine tiles"` — Part 7 PR.

---

## Part 8 — Copy pass (`feat/ui-copy`)

### Task 28: Status strings say what happens next

**Files:** Modify `packages/i18n/src/locales/en.json`. Test `packages/i18n/test/status-copy.test.ts` (create).

- [ ] **Step 1: Find every status string.** Run:

```bash
node -e '
const en = require("./packages/i18n/src/locales/en.json");
const walk = (o, p = []) => Object.entries(o).flatMap(([k, v]) => typeof v === "object" ? walk(v, [...p, k]) : [[[...p, k].join("."), v]]);
const bare = /^(Not installed|Installed|Not set|Set|OK|Failed|Queued|Waiting|Running|Working…?|In progress|Turned off|Off|On|Ready|Stored|Connected|Paused)\.?$/i;
for (const [k, v] of walk(en)) if (bare.test(String(v).trim())) console.log(k, "=", JSON.stringify(v));
'
```

Copy the output into the PR body. For each key, decide: (a) it is a tag whose card shows a next-step line next to it (keep; name the line's key), or (b) it stands alone (rewrite with " · <next step>").

- [ ] **Step 2: Write the failing test** with the keys from (b) and the spec §6 table:

```ts
import { describe, expect, it } from "vitest";
import en from "../src/locales/en.json";

const get = (path: string) => path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en) as string;

/** Every state says what happens next (UI refresh spec §6). Keys found in Task 28 Step 1, case (b). */
const STANDALONE = [
  "engine.status.notInstalled",
  "engine.status.installed",
  "connections.status.notSet",
  "plugins.status.crashed",
  "parallel.queuedLine",
  "jobs.result.ok",
  "jobs.result.failed",
  // add the rest of Step 1's (b) list here
];

describe("status copy", () => {
  it.each(STANDALONE)("%s names the next step", (key) => {
    const text = get(key);
    expect(text, key).toBeTruthy();
    expect(text, key).toMatch(/ · /);
  });
  it("matches the spec's examples", () => {
    expect(get("engine.status.notInstalled")).toBe("Not on this computer yet · we install it next");
    expect(get("engine.status.installed")).toBe("Installed · pick a provider to use it");
    expect(get("parallel.queuedLine")).toBe("Starts when a slot frees up · {{cap}} tasks at once");
  });
});
```

Replace the example key paths with the real ones from Step 1 before running.

- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Rewrite the strings** (spec §6 table): Not on this computer yet · we install it next; Installed · pick a provider to use it; Starts when a slot frees up · {{cap}} tasks at once; Paused until tomorrow · daily token cap reached; OK · Next run {{next}}; Not set · paste the key to use {{plugin}}; Turned off after crashes · turn it on to try again; Close to your limit · renews {{when}}; Waiting for you · {{ago}}. Use "Working" for a task the AI is on everywhere (Q4): replace "Running" and "In progress" task labels.
- [ ] **Step 5: Run** `corepack pnpm test` → PASS (component tests asserting old texts: update the expected text).
- [ ] **Step 6: Commit** `git commit -am "feat(i18n): every status says what happens next"`

### Task 29: Final check

- [ ] **Step 1:** `corepack pnpm typecheck && corepack pnpm test && corepack pnpm e2e` → all green; note the test count against the "Before you start" count.
- [ ] **Step 2:** Run `look.spec.ts`, put the screenshots next to the mockups (light and dark) in the PR body for Marco's review.
- [ ] **Step 3:** Grep for leftovers: `grep -rn 'hh-sheet\|--hh-paper\|--hh-slate\|Lexend\|clip-path' packages/ui/src packages/shell/src` → nothing outside `plugin-ui/tokens.css` aliases.
- [ ] **Step 4: Commit** any fix, write the Part 8 PR body, and update the spec's status line: "implemented in plan docs/superpowers/plans/2026-10-30-ui-refresh.md, see each PR's Conflicts with the plan".

---

## Self-review against the spec

| Spec | Tasks |
|---|---|
| §3.1 colors, aliases, plugin tokens | 1, 2 |
| §3.2 DM Sans bundled, 14px, scale, radii, hit targets, no chamfer | 3, 4, per-screen CSS |
| §3.3 tags by meaning, tiers | 4, used in 11–27 |
| §4.1 top bar (80px inset, logo, breadcrumb, Inbox, bell, avatar; search hidden Q1; avatar only with profiles Q2) | 7, 9 |
| §4.2 rail, D0 entries, narrow layout | 5, 6, 8 |
| §4.3 side columns on rail ground | 12, 24 |
| §5.1 chat: flow side, task header, tabs + phases, conversation, choices, composer, Sidekick | 10–12 |
| §5.2 Home + Pick up | 15, 16 |
| §5.3 Start view + Cards / List | 13 |
| §5.4 Inbox board (Board default Q5), jobs, conflict card | 17–19 |
| §5.5 Settings page, sections | 20–23 |
| §5.6 Setup | 27 |
| §5.7 drawers, reader docked (Q3), context + timeline in drawer | 24–26 |
| §6 copy rule, "Working" (Q4) | 28 |
| §7 no behavior change, D0, a11y | tests in 5, 8, 9, 20, 24 |
| §9 testing (tokens, contrast, rail, Home, Start, Settings, e2e screenshots) | 1, 3, 5, 13, 16, 20, 14/29 |
| Q6 eight stacked PRs | Parts table |
