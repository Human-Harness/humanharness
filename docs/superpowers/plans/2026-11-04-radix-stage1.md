# Radix + Impeccable, stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app runs inside one Radix Themes root that reads our tokens and changes nothing on screen. Screens get the allowed Radix pieces from the guide barrel, and the guard test keeps Radix behind that barrel. Impeccable, PRODUCT.md and DESIGN.md are in the repo and linked from CLAUDE.md, and the PR template carries the UI loop.

**Status:** written 2026-11-04 and waiting for Marco's review. Not started.

**Spec:** `docs/superpowers/specs/2026-11-04-radix-impeccable-design.md` (merged in PR #122), section 7, stage 1. Stage 0 is already decided: nothing is reverted, and Part 5 was discarded. No screen moves to Radix in this stage; that starts in stage 2 (Settings).

**Architecture:**
- `packages/ui/src/guide/Theme.tsx` holds `HhTheme`, the one `<Theme accentColor="amber" grayColor="sand" radius="large">`.
  - Its appearance follows `prefers-color-scheme`, the same switch the `--hh-*` tokens use. The shell drives that switch through `nativeTheme`.
  - It renders no box (`display: contents`) and gives children no text style of its own. A bridge block in `styles.css` maps Radix's font and background variables to ours.
- `packages/shell/src/renderer/main.tsx` wraps the harness `App` in `HhTheme`.
- `packages/ui/src/guide/radix.ts` re-exports the allowed Radix pieces, and the barrel exposes them as the `Rx` namespace. A namespace avoids a clash with today's guide `Button`, `IconButton`, `Tabs` and `Checkbox` until stage 7 deletes those.
- A new guard test fails on two things: any import of `@radix-ui/themes` outside `packages/ui/src/guide/`, and any change to the allowed list that doesn't come with its test.
- Impeccable is vendored into `.claude/skills/impeccable/`. A `.gitignore` exception lets it in while the rest of `.claude/` stays ignored.

**Tech Stack:** React 19 + TypeScript, `@radix-ui/themes` 3.3.0, plain CSS, Vitest + Testing Library (happy-dom), Playwright e2e (`packages/e2e`), Electron renderer with a strict CSP, Impeccable skill 4.8.0 (Apache-2.0).

---

## Rules for whoever implements this

1. **Decide nothing about UI.** This stage must change nothing on screen. If a screenshot differs from master in any way (a font, a color, a gap, a button border), stop. Put the before/after pair in the PR body under "Questions for Marco", with options and a "Dejar para después" option. Never pick a visual value yourself.
2. **One stage = one PR.** Branch `feat/radix-stage1` from `origin/master`, PR to `master`. An agent may push the branch and open the PR. Only Marco merges.
3. **The app keeps working.** The gate is green, and the demo runs in light and dark (`corepack pnpm start-demo`) with no broken screen.
4. **The offenders list only shrinks.** Never add a line to `packages/ui/test/style-guard-offenders.json`.
5. **Re-check anchors.** File names below were read on `origin/master` at fe36c0de. If a file moved, use the new name and note it in the PR body under "Conflicts with the plan".
6. **CLAUDE.md:** master has none today, but the `worktree-harness-discovery` branch edits one. If master has a CLAUDE.md when you start Task 8, add the section from Task 8 to it instead of creating the file.
7. **Gate** (run from the repo root): `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`, `corepack pnpm e2e`.

## Files

| File | Change | Responsibility |
|---|---|---|
| `packages/ui/package.json` | modify | add `@radix-ui/themes` 3.3.0 |
| `packages/ui/src/guide/Theme.tsx` | create | `HhTheme` and `useSystemDark` |
| `packages/ui/src/guide/radix.ts` | create | the allowed Radix pieces, nothing else |
| `packages/ui/src/guide/index.ts` | modify | export `HhTheme` and `Rx` |
| `packages/ui/src/guide/classes.ts` | modify | add `hh-theme` |
| `packages/ui/src/styles.css` | modify | the Radix bridge block |
| `packages/ui/src/index.ts` | modify | export `HhTheme` for the shell |
| `packages/shell/src/renderer/main.tsx` | modify | wrap `App` in `HhTheme` |
| `packages/ui/test/guide-theme.test.tsx` | create | `HhTheme` unit tests |
| `packages/ui/test/radix-barrel.test.ts` | create | allowed list and import guard |
| `packages/e2e/tests/theme-frame.spec.ts` | create | the root adds no box, follows the system, and leaves text as it was |
| `.gitignore` | modify | let `.claude/skills/impeccable/` in |
| `.claude/skills/impeccable/**` | create | vendored skill, tag `skill-v4.8.0` |
| `NOTICE` | create | third-party notice for Impeccable |
| `PRODUCT.md` | create | product truth, Impeccable `init` format |
| `DESIGN.md` | create | our design rules, Impeccable `document` format |
| `CLAUDE.md` | create | links PRODUCT.md, DESIGN.md and the UI loop |
| `.github/pull_request_template.md` | create | UI checklist |

---

### Task 1: HhTheme

**Files:**
- Modify: `packages/ui/package.json`
- Create: `packages/ui/src/guide/Theme.tsx`
- Test: `packages/ui/test/guide-theme.test.tsx`

- [ ] **Step 1: Add the dependency**

In `packages/ui/package.json`, in `dependencies`, after `"@humanharness/protocol": "workspace:*",`, add:

```json
    "@radix-ui/themes": "3.3.0",
```

Run: `corepack pnpm install`
Expected: the lockfile gains `@radix-ui/themes@3.3.0`, and no other dependency changes version (`git diff pnpm-lock.yaml` shows only Radix packages).

- [ ] **Step 2: Write the failing test**

Create `packages/ui/test/guide-theme.test.tsx`:

```tsx
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HhTheme } from "../src/guide/Theme";

/** A matchMedia stand-in whose dark flag the test can flip, firing "change" like the real one. */
function fakeSystem(dark: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const media = {
    matches: dark,
    addEventListener: (_: string, f: (e: { matches: boolean }) => void) => listeners.add(f),
    removeEventListener: (_: string, f: (e: { matches: boolean }) => void) => listeners.delete(f),
  };
  vi.spyOn(window, "matchMedia").mockImplementation(() => media as unknown as MediaQueryList);
  return (next: boolean) => {
    media.matches = next;
    for (const f of listeners) f({ matches: next });
  };
}

describe("HhTheme (Radix + Impeccable spec §3)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is one Radix root with our accent, gray and radius, and no background of its own", () => {
    fakeSystem(false);
    const { container, getByText } = render(<HhTheme><p>hola</p></HhTheme>);
    const root = container.querySelector(".radix-themes.hh-theme");
    expect(root).not.toBeNull();
    expect(root!.getAttribute("data-accent-color")).toBe("amber");
    expect(root!.getAttribute("data-gray-color")).toBe("sand");
    expect(root!.getAttribute("data-radius")).toBe("large");
    expect(root!.getAttribute("data-has-background")).toBe("false");
    expect(root!.contains(getByText("hola"))).toBe(true);
  });

  it("follows prefers-color-scheme, like the --hh-* tokens, and switches when the system does", () => {
    const flip = fakeSystem(true);
    const { container } = render(<HhTheme><p>x</p></HhTheme>);
    const root = () => container.querySelector(".radix-themes.hh-theme")!;
    expect(root().classList.contains("dark")).toBe(true);
    act(() => flip(false));
    expect(root().classList.contains("light")).toBe(true);
    expect(root().classList.contains("dark")).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/guide-theme.test.tsx`
Expected: FAIL, because `../src/guide/Theme` cannot be resolved.

- [ ] **Step 4: Write the component**

Create `packages/ui/src/guide/Theme.tsx`:

```tsx
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import { type ReactNode, useEffect, useState } from "react";

const DARK = "(prefers-color-scheme: dark)";

/**
 * True while the system is dark. The shell sets nativeTheme from the app's appearance setting, and the --hh-* tokens
 * follow only this media query, so Radix must follow it too, not the config (the spike's first bug was that mismatch).
 */
export function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => typeof matchMedia === "function" && matchMedia(DARK).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia(DARK);
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    setDark(media.matches);
    media.addEventListener("change", on);
    return () => media.removeEventListener("change", on);
  }, []);
  return dark;
}

/** The app's one Radix Themes root (Radix + Impeccable spec §3). It draws no box; the bridge is in styles.css. */
export function HhTheme({ children }: { children: ReactNode }) {
  const dark = useSystemDark();
  return (
    <Theme className="hh-theme" accentColor="amber" grayColor="sand" radius="large" appearance={dark ? "dark" : "light"} hasBackground={false}>
      {children}
    </Theme>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/ui/test/guide-theme.test.tsx`
Expected: PASS, 2 tests. If the CSS import fails under Vitest, stop and report it. The spike imported the same file in a TSX under test without trouble.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/package.json pnpm-lock.yaml packages/ui/src/guide/Theme.tsx packages/ui/test/guide-theme.test.tsx
git commit -m "feat(ui): HhTheme, the one Radix Themes root following the system's dark mode"
```

### Task 2: The bridge

**Files:**
- Modify: `packages/ui/src/styles.css`
- Modify: `packages/ui/src/guide/classes.ts`
- Test: `packages/ui/test/style-guard.test.ts` (existing: "every guide class has a rule in styles.css")

- [ ] **Step 1: Add the class to the guide list (the failing check)**

In `packages/ui/src/guide/classes.ts`, inside the `GUIDE_CLASSES` set, after the `// Icon (§4)` group, add:

```ts
  // HhTheme: the Radix Themes root (Radix + Impeccable spec §3)
  "hh-theme",
```

- [ ] **Step 2: Run the guard to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/style-guard.test.ts -t "every guide class"`
Expected: FAIL on `hh-theme`, because styles.css has no rule for it yet.

- [ ] **Step 3: Write the bridge**

In `packages/ui/src/styles.css`, add this block right after the base element rules (after the line `a { color: var(--hh-ink); }`):

```css
/* Radix bridge (Radix + Impeccable spec §3). Radix pieces read our fonts and background, in every Radix root,
 * including the ones its overlays open on <body>. :root raises the specificity above Radix's own `.radix-themes`. */
:root .radix-themes {
  --default-font-family: var(--hh-font);
  --heading-font-family: var(--hh-display);
  --code-font-family: var(--hh-mono);
  --color-background: var(--hh-bg);
}
/* The app's root draws no box and gives its children no text style: the screens look exactly as before. */
.radix-themes.hh-theme { display: contents; font: inherit; line-height: inherit; letter-spacing: inherit; color: inherit; }
```

- [ ] **Step 4: Run the guard to verify it passes**

Run: `corepack pnpm vitest run packages/ui/test/style-guard.test.ts`
Expected: PASS, every test in the file. The block has only `var()`, `inherit` and `contents`, so the scanner reports no new offender.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/styles.css packages/ui/src/guide/classes.ts
git commit -m "feat(ui): Radix bridge, our fonts and background with no box and no text style"
```

### Task 3: Mount the root in the app

**Files:**
- Modify: `packages/ui/src/guide/index.ts`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/shell/src/renderer/main.tsx`
- Create: `packages/e2e/tests/theme-frame.spec.ts`

- [ ] **Step 1: Write the failing e2e test**

Create `packages/e2e/tests/theme-frame.spec.ts`:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { closeAndClean, launchMock, makeSandbox } from "./helpers";

// Radix + Impeccable stage 1: the Radix root wraps the app, follows the system's dark mode and changes nothing on
// screen. The screenshots go next to look.spec's (gitignored) for the before/after comparison in the PR.
const here = path.dirname(fileURLToPath(import.meta.url));
const lookDir = path.resolve(here, "..", "test-results", "look");

for (const theme of ["light", "dark"] as const) {
  test(`theme frame: one Radix root, no box, ${theme}`, async () => {
    const s = makeSandbox(`theme-frame-${theme}`);
    const { app, page } = await launchMock(s);
    try {
      await page.emulateMedia({ colorScheme: theme });
      const root = page.locator(".radix-themes.hh-theme");
      await expect(root).toHaveCount(1);
      await expect(root).toHaveClass(new RegExp(`(^|\\s)${theme}(\\s|$)`));
      const look = await root.evaluate((el) => {
        const own = getComputedStyle(el);
        const body = getComputedStyle(document.body);
        const child = getComputedStyle(el.firstElementChild!);
        return {
          display: own.display,
          child: [child.fontFamily, child.fontSize, child.lineHeight, child.color],
          body: [body.fontFamily, body.fontSize, body.lineHeight, body.color],
        };
      });
      expect(look.display).toBe("contents");
      expect(look.child).toEqual(look.body);
      expect(look.body[1]).toBe("14px");
      expect(look.body[0]).toContain("DM Sans");
      await page.screenshot({ path: path.join(lookDir, `theme-frame-${theme}.png`) });
    } finally {
      await closeAndClean(app, s);
    }
  });
}
```

If `el.firstElementChild` sets its own font or color in styles.css, the `child` vs `body` check fails for that reason, not because of Radix. Then compare against the first child's styles on master instead (Step 6), and note the change in the PR.

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm app:build && corepack pnpm --filter @humanharness/e2e exec playwright test tests/theme-frame.spec.ts`
Expected: FAIL. `.radix-themes.hh-theme` has count 0.

- [ ] **Step 3: Export HhTheme**

In `packages/ui/src/guide/index.ts`, add as the last line:

```ts
export * from "./Theme";
```

In `packages/ui/src/index.ts`, after `export * from "./usage";`, add:

```ts
// The app's one Radix Themes root; the shell wraps the harness App in it (Radix + Impeccable spec §3).
export { HhTheme } from "./guide/Theme";
```

- [ ] **Step 4: Wrap the App**

Replace `packages/shell/src/renderer/main.tsx` with:

```tsx
import { createRoot } from "react-dom/client";
import App from "@harness/ui";
import { HhTheme } from "@humanharness/ui";
// DM Sans for all text, DM Mono for code and keys, bundled with the app (no network fonts: the renderer's CSP allows 'self' only).
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-mono/400.css";
import "@humanharness/ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <HhTheme>
    <App client={window.hh} />
  </HhTheme>,
);
```

`packages/shell/package.json` already depends on `@humanharness/ui` (`workspace:*`), so no install is needed.

- [ ] **Step 5: Run the e2e test to verify it passes**

Run: `corepack pnpm app:build && corepack pnpm --filter @humanharness/e2e exec playwright test tests/theme-frame.spec.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Before/after screenshots**

Run `look.spec.ts` on this branch and on `origin/master`, keeping each run's `packages/e2e/test-results/look/` in a separate folder of the session scratchpad:

```bash
corepack pnpm app:build && corepack pnpm --filter @humanharness/e2e exec playwright test tests/look.spec.ts
```

Open each pair and compare by eye. Any difference stops the task (Rule 1). If there are none, say so in the PR body under "Screenshots" and attach one light and one dark pair.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/guide/index.ts packages/ui/src/index.ts packages/shell/src/renderer/main.tsx packages/e2e/tests/theme-frame.spec.ts
git commit -m "feat(shell): the app runs inside HhTheme; e2e checks it changes nothing"
```

### Task 4: The barrel and its guard

**Files:**
- Create: `packages/ui/src/guide/radix.ts`
- Modify: `packages/ui/src/guide/index.ts`
- Test: `packages/ui/test/radix-barrel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/radix-barrel.test.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Rx } from "../src/guide";

const REPO = resolve(__dirname, "../../..");

/**
 * The Radix pieces screens may use (Radix + Impeccable spec §3, table "Guide piece → Becomes", plus the layout
 * and text primitives every composition needs). A piece enters this list only in the PR that adds it to DESIGN.md.
 */
const ALLOWED = [
  "AlertDialog", "Avatar", "Badge", "Box", "Button", "Callout", "Card", "Checkbox", "Code", "Dialog",
  "DropdownMenu", "Flex", "Grid", "Heading", "IconButton", "Popover", "Progress", "RadioGroup", "ScrollArea",
  "SegmentedControl", "Select", "Separator", "Switch", "Tabs", "Text", "TextArea", "TextField",
];

const RADIX_IMPORT = /(?:from\s+|import\s+|import\()\s*["']@radix-ui\/themes(?:\/[^"']*)?["']/;

function sources(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.split(/[\\/]/).includes("node_modules"))
    .map((f) => join(dir, f));
}

describe("Radix behind the guide barrel (Radix + Impeccable spec §3)", () => {
  it("the barrel exposes exactly the allowed Radix pieces", () => {
    expect(Object.keys(Rx).sort()).toEqual([...ALLOWED].sort());
  });

  it("only packages/ui/src/guide imports @radix-ui/themes", () => {
    const guide = join(REPO, "packages/ui/src/guide");
    const files = [...sources(join(REPO, "packages/ui/src")), ...sources(join(REPO, "packages/shell/src"))];
    const outside = files.filter((f) => !f.startsWith(guide) && RADIX_IMPORT.test(readFileSync(f, "utf8")));
    expect(outside.map((f) => f.slice(REPO.length + 1)), "import Radix pieces from packages/ui/src/guide (Rx), never from @radix-ui/themes").toEqual([]);
  });

  it("the import check sees the forms a screen could use", () => {
    for (const s of ['import { Button } from "@radix-ui/themes";', "import '@radix-ui/themes/styles.css';", 'const m = await import("@radix-ui/themes");'])
      expect(RADIX_IMPORT.test(s), s).toBe(true);
    expect(RADIX_IMPORT.test('import { Rx } from "./guide";')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/radix-barrel.test.ts`
Expected: FAIL, because `Rx` is not exported from `../src/guide`.

- [ ] **Step 3: Write the barrel**

Create `packages/ui/src/guide/radix.ts`:

```ts
/**
 * The Radix Themes pieces screens may use, and nothing else (Radix + Impeccable spec §3). Screens import them as
 * `Rx` from the guide barrel; packages/ui/test/radix-barrel.test.ts keeps this list and the import rule closed.
 */
export {
  AlertDialog, Avatar, Badge, Box, Button, Callout, Card, Checkbox, Code, Dialog, DropdownMenu, Flex, Grid, Heading,
  IconButton, Popover, Progress, RadioGroup, ScrollArea, SegmentedControl, Select, Separator, Switch, Tabs, Text,
  TextArea, TextField,
} from "@radix-ui/themes";
```

In `packages/ui/src/guide/index.ts`, add as the last line:

```ts
// Radix pieces as a namespace: today's guide Button, IconButton, Tabs and Checkbox keep their names until stage 7.
export * as Rx from "./radix";
```

- [ ] **Step 4: Run it to verify it passes**

Run: `corepack pnpm vitest run packages/ui/test/radix-barrel.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Typecheck**

Run: `corepack pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/guide/radix.ts packages/ui/src/guide/index.ts packages/ui/test/radix-barrel.test.ts
git commit -m "feat(ui): Rx, the allowed Radix pieces behind the guide barrel, with its guard"
```

### Task 5: Vendor Impeccable

**Files:**
- Modify: `.gitignore`
- Create: `.claude/skills/impeccable/**`, `NOTICE`

- [ ] **Step 1: Let the skill folder past `.gitignore`**

In `.gitignore`, replace the line `.claude/` with:

```
# Local Claude state stays out; the vendored Impeccable skill is in (Radix + Impeccable spec §4).
.claude/*
!.claude/skills/
.claude/skills/*
!.claude/skills/impeccable/
```

Check:

```bash
mkdir -p .claude/skills/impeccable && touch .claude/skills/impeccable/probe
git check-ignore -q .claude/skills/impeccable/probe; echo "skill ignored: $?"
git check-ignore -q .claude/settings.local.json; echo "settings ignored: $?"
git check-ignore -q .claude/worktrees/x/file; echo "worktrees ignored: $?"
git check-ignore -q .claude/skills/other/SKILL.md; echo "other skill ignored: $?"
rm .claude/skills/impeccable/probe
```

Expected: `skill ignored: 1`, `settings ignored: 0`, `worktrees ignored: 0`, `other skill ignored: 0`.

- [ ] **Step 2: Copy the skill at its tag**

Use the session scratchpad (call it `$SCRATCH`) for the clone:

```bash
git clone --depth 1 --branch skill-v4.8.0 https://github.com/pbakaus/impeccable "$SCRATCH/impeccable-4.8.0"
ls "$SCRATCH/impeccable-4.8.0/.claude/skills/impeccable"
```

Expected: `reference  scripts  SKILL.md`. If the tag has no `.claude/skills/impeccable/`, stop and ask Marco. Don't build the skill from another folder.

```bash
cp -R "$SCRATCH/impeccable-4.8.0/.claude/skills/impeccable/." .claude/skills/impeccable/
cp "$SCRATCH/impeccable-4.8.0/LICENSE" .claude/skills/impeccable/LICENSE
cp "$SCRATCH/impeccable-4.8.0/NOTICE.md" .claude/skills/impeccable/NOTICE.md
find .claude/skills/impeccable -type f -size +1M
```

Expected from `find`: nothing. No binary is vendored, because the launcher downloads its binary to `~/.impeccable/` on first run (allowed, spec §9.1). If a file over 1 MB shows up, stop and ask.

- [ ] **Step 3: Write NOTICE**

Create `NOTICE` at the repo root:

```
Human Harness includes third-party work, used under its original license.

Impeccable
  Source:  https://github.com/pbakaus/impeccable, tag skill-v4.8.0
  Files:   .claude/skills/impeccable/
  License: Apache License 2.0, see .claude/skills/impeccable/LICENSE
  Its own notices: .claude/skills/impeccable/NOTICE.md
  Updated only by a pull request that changes the tag above.
```

- [ ] **Step 4: Check that the launcher runs**

Run: `.claude/skills/impeccable/scripts/impeccable --version`
Expected: a version line. The first run downloads the binary to `~/.impeccable/bin/`. If the download fails (offline, blocked), write that in the PR body and continue: the skill documents a "launcher unavailable" path.

- [ ] **Step 5: Commit**

```bash
git add .gitignore NOTICE .claude/skills/impeccable
git status --short .claude | head
git commit -m "chore: vendor the Impeccable design skill 4.8.0 (Apache-2.0)"
```

Before committing, check that `git status` lists only files under `.claude/skills/impeccable/`.

### Task 6: PRODUCT.md

**Files:**
- Create: `PRODUCT.md`

- [ ] **Step 1: Read the format**

Read `.claude/skills/impeccable/reference/init.md`. Its Step 4 gives PRODUCT.md's sections: Platform, Stack, Users, Product Purpose, Positioning, Operating Context, Capabilities and Constraints, Brand Commitments, Evidence on Hand, Product Principles, Accessibility & Inclusion.

- [ ] **Step 2: Write it from what the repo already says**

Fill each section only from these sources, citing a source path at the end of each section:
- `README.md`
- `docs/architecture/`
- `site/`
- `docs/superpowers/specs/2026-10-25-*` (the core specs, including the language-on-demand spec)
- `docs/superpowers/specs/2026-11-04-radix-impeccable-design.md`

Two facts must appear. **Platform:** an Electron desktop app for macOS, plus plugin panels that run inside sandboxed iframes. **Stack:** React, Radix Themes and the Impeccable loop.

Where init.md's Step 3 interview needs an answer the sources don't give, write `Open: <question>` in that section. Copy each question into the PR body under "Questions for Marco", with options and "Dejar para después". Never invent users, positioning or brand.

- [ ] **Step 3: Check that Impeccable loads it**

Run: `.claude/skills/impeccable/scripts/impeccable context`
Expected: the output names PRODUCT.md as loaded. DESIGN.md comes in Task 7.

- [ ] **Step 4: Commit**

```bash
git add PRODUCT.md
git commit -m "docs: PRODUCT.md for Impeccable, from the repo's own docs"
```

### Task 7: DESIGN.md

**Files:**
- Create: `DESIGN.md`

- [ ] **Step 1: Read the format**

Read `.claude/skills/impeccable/reference/document.md`. It sets the frontmatter token schema and eight body sections, in this order: Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts.

- [ ] **Step 2: Write the frontmatter tokens**

Copy every color token from the light `:root` block of `packages/ui/src/styles.css`, and the matching dark values from its `@media (prefers-color-scheme: dark)` block. Then copy the radii (`--hh-r-*`), spacing (`--hh-s-1`…`--hh-s-6`) and fonts (`--hh-font`, `--hh-display`, `--hh-mono`). Use the token names as they are in styles.css. Values come from the file, not from memory. Do not copy heights (`--hh-h-*`): sizes follow Radix's scale 1–4 (spec §9.5).

- [ ] **Step 3: Write the body**

Each section restates rules that already exist. Add no new rule.

- **Overview:** Radix Themes provides the pieces (accent amber, gray sand, radius large, sizes 1–4). Impeccable provides the loop. This file holds the rules, and a screen uses only pieces listed here (spec §1, §2 "Closed world").
- **Colors, Typography, Shapes:** the tokens from Step 2, with each token's use, taken from the "Use" column of guide spec §2 (`docs/superpowers/specs/2026-11-02-style-guide-design.md`).
- **Layout:** screen templates and fixed parts (guide §9), work-screen zones and their closed contents (guide §10), secondary pages, Inicio, Assistant and Settings (guide §11–12). Also the new rules from Radix + Impeccable spec §2: settings row anatomy, and at most one highlighted band per page. Add a narrow-panel line: plugin panels must work at 240 px with no horizontal scroll (spec §6).
- **Elevation & Depth:** what guide §6 "Card" and §8 "Overlays" say about cards, dialogs and backdrops.
- **Components:** one subsection per row of spec §3's table, naming the Radix piece and its `Rx.` name. Then the rules from guide §5, minus heights: label on top, help, error, spacing and the 12 field types. Then control per kind of setting, and status as a badge (spec §2). Option, Tile, StepMark, EmptyState and InlineConfirm are not listed (spec §9.3).
- **Do's and Don'ts:** the action rules (spec §2: one primary action, last on the right; Volver and Cerrar; Settings saves itself). Also: no loose character in place of an icon. No Dialog, Popover or Menu inside plugin panels (spec §6). A new piece enters through a decision page and one PR. The UI loop of spec §5 (shape → build → look → critique, three rounds at most).

Cite the source section in parentheses at the end of each rule, e.g. `(guide §9)`, so a later reader can check it.

- [ ] **Step 4: Check that Impeccable loads both files**

Run: `.claude/skills/impeccable/scripts/impeccable context`
Expected: the output names PRODUCT.md and DESIGN.md as loaded, with no schema warning. Fix any warning it prints.

- [ ] **Step 5: Commit**

```bash
git add DESIGN.md
git commit -m "docs: DESIGN.md, the guide's rules on Radix pieces, in Impeccable's format"
```

### Task 8: CLAUDE.md and the PR template

**Files:**
- Create: `CLAUDE.md` (see Rule 6)
- Create: `.github/pull_request_template.md`

- [ ] **Step 1: Write CLAUDE.md**

```markdown
# Human Harness

## UI work

Every change that touches UI follows the Radix + Impeccable spec (`docs/superpowers/specs/2026-11-04-radix-impeccable-design.md`):

- Read `PRODUCT.md` and `DESIGN.md` first; use the `impeccable` skill (`.claude/skills/impeccable/`).
- Build only with pieces from `packages/ui/src/guide` (Radix pieces as `Rx`); never import `@radix-ui/themes` elsewhere.
- Loop: shape (a short plan in the PR) → build → screenshots light and dark through an e2e spec → critique and fix, three rounds at most.
- Decide no visual value the spec or DESIGN.md does not state: ask, with a "Dejar para después" option.
```

- [ ] **Step 2: Write the PR template**

Create `.github/pull_request_template.md`:

```markdown
## What and why

## Questions for Marco

## UI checklist (skip if the PR touches no UI)

- [ ] Shape: the plan is below (user tasks, hierarchy, which DESIGN.md pattern each part uses)
- [ ] Build: only pieces from `packages/ui/src/guide`; the style guard and the Radix barrel test pass
- [ ] Look: screenshots light and dark from an e2e spec are attached
- [ ] Critique: rounds of critique and fix done (at most three); what changed in each
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md .github/pull_request_template.md
git commit -m "docs: CLAUDE.md points agents to PRODUCT.md, DESIGN.md and the UI loop; PR template checklist"
```

### Task 9: Gate and PR

- [ ] **Step 1: Run the whole gate**

```bash
corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build && corepack pnpm e2e
```

Expected: all green. Known flaky tests (the coach queue lists `on-this-day.test.ts` "dist byte-identical" and the shell watcher test) pass when rerun alone. Name any of them that you had to rerun in the PR body.

- [ ] **Step 2: Run the demo by hand**

Run: `corepack pnpm start-demo`. Switch Settings › Appearance to Dark and back to Light. Expected: every screen looks as on master in both modes.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/radix-stage1
gh pr create --base master --title "Radix + Impeccable, stage 1: theme root, barrel, Impeccable, DESIGN.md" --body-file "$SCRATCH/radix-stage1-pr.md"
```

Write the body with the new PR template's sections. It contains:
- the before/after screenshots from Task 3 Step 6
- the open questions from Tasks 6 and 7
- any conflicts with the plan

Then stop. Stage 2 (Settings) gets its own plan.

---

## Decided by this plan (for Marco's review)

These are code choices, not visual ones. Marco can change any of them in review.

1. Radix pieces live under the `Rx` namespace (`<Rx.Button>`) until stage 7 deletes today's guide pieces with the same names.
2. Besides the spec's table, the barrel allows the layout and text primitives the spike used: `Box`, `Flex`, `Grid`, `Heading`, `Text`, `Code`, `Separator` and `ScrollArea`. `Grid` is the one the spike did not use.
3. The bridge is a block in `styles.css`, not a separate file. That way the guard's "every guide class has a rule" check covers it.
4. `HhTheme` imports Radix's CSS itself, so any root that uses it gets the CSS. Plugin panels come in stage 6.
5. The license notice goes in a new root `NOTICE` file. A `.gitignore` exception lets in only `.claude/skills/impeccable/`.
