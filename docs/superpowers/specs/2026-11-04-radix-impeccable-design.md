# Radix Themes + Impeccable — design

Date: 2026-11-04
Status: approved by Marco on 2026-11-04 (answers in section 9)
Decided by Marco on 2026-11-04: the app moves to Radix Themes for its pieces, and Impeccable joins the repo as the design skill every agent uses for UI work, with a DESIGN.md.
Evidence: spike branch `worktree-spike-radix-themes` (commits 7f92c425, 7ffedf34, 9d6782e9) and the comparison page https://claude.ai/artifact/4FFL2gSjDUWeC6mSYWpRx1.
Builds on: `2026-11-02-style-guide-design.md` (the closed-world guide), `2026-10-27-plugins-design.md`.

## 1. Why

The closed-world guide (Parts 1–4 merged, Part 5 in progress) was meant to make every screen come out well. Two findings from the spike changed the plan:

- **Pieces are not the problem.** Hand-building every piece (buttons, segmented, fields, cards) costs a lot and Radix Themes already has them, closed by props, themable with our tokens, working in light and dark and inside plugin panels under the panel CSP.
- **Composition is the problem.** With good pieces, an agent without a design process still made a bad Settings page. A fresh agent using Impeccable (plan first, then screenshot → critique → fix) made a good one with the same pieces. What made the difference was the process and the composition rules, not the component library.

So: Radix gives the pieces, Impeccable gives the process, and DESIGN.md holds our rules so every agent composes the same way.

## 2. What stays from the style guide

The guide's rules are still right; only who builds the pieces changes. These move, restated, into `DESIGN.md`:

- Color, type, radius and spacing values (guide section 2), light and dark. Heights are not kept: pieces use Radix's size scale 1–4 (section 9.5).
- Screen templates and their fixed parts (section 9), the work screen zones and their closed contents (section 10), secondary pages, Inicio, Assistant and Settings (sections 11–12).
- Action rules: one primary action per screen, card or dialog, last on the right; Volver on pages, Cerrar only in dialogs and split view; changes in Settings save themselves.
- Closed world: a screen uses only pieces from DESIGN.md; a loose character never stands in for an icon; a new piece enters through a decision page and one PR (section 15).
- Our icon set (section 4) stays; Radix has no icons of its own that we adopt.

New in DESIGN.md, taken from what the spike agent had to invent:

- **Settings row anatomy:** name and hint on the left, control right-aligned in one column, hairline between rows; rows grouped in cards, no nested cards; tight spacing inside a group, generous between groups.
- **Control per kind of setting:** 2–4 instant choices → segmented; a number in a small range or a long list → select; on/off → switch; a value chosen elsewhere → value + "Change…" button.
- **Status as a badge**, colored by state (green ok, amber needs attention, gray off), not a sentence.
- **One highlighted band per page** at most, for the one thing that needs the person.

## 3. Pieces: Radix instead of our own

`<Theme accentColor="amber" grayColor="sand" radius="large">` wraps the app. A small bridge stylesheet maps Radix variables to our tokens (fonts, background), as `packages/ui/src/spike/radix-spike.css` does. Dark mode follows `prefers-color-scheme`, which the shell drives through `nativeTheme` from the app's appearance setting, so Radix and our tokens always agree (the spike's first bug was exactly this mismatch).

| Guide piece | Becomes |
|---|---|
| Button (types and sizes), IconButton | Radix `Button`, `IconButton` (variant + size) |
| Segmented, Tabs | `SegmentedControl`, `Tabs` |
| NavItem | `Button variant="ghost"` inside our `SettingsNav` / rail wrappers |
| Toggle, Checkbox | `Switch`, `Checkbox` |
| Field and the 12 field types | `TextField`, `TextArea`, `Select`, `RadioGroup`, `Checkbox`, `Switch`; our `Field` wrapper keeps label-on-top and hint |
| SettingsRow, Card | `Card` + our `Group` / `Row` (from the spike) |
| Tag, Chip, Counter, Dot | `Badge` (variants); Dot stays ours |
| Notice, StatusLine | `Callout` |
| Dialog, Popover, Menu | `AlertDialog`/`Dialog`, `Popover`, `DropdownMenu` |
| ProgressBar | `Progress` |
| Avatar | `Avatar` |
| Option, Tile, StepMark, EmptyState, InlineConfirm | dropped; the screens that use them are redesigned without them (section 9.3) |

Our wrappers stay few and closed: each is a piece in DESIGN.md. Screens import from one barrel (`packages/ui/src/guide`) that re-exports the allowed Radix pieces plus our wrappers, so the guard test (guide section 15) can keep checking "only allowed pieces".

## 4. Impeccable in the repo

- Vendor `pbakaus/impeccable` 4.8.0 into `.claude/skills/impeccable/` with its Apache-2.0 LICENSE and a NOTICE line; pinned, updated by PR.
- Generate `PRODUCT.md` (with `impeccable init`) and `DESIGN.md` (with `impeccable document`, then rewritten from section 2 of this spec and the guide). Both live at the repo root; `CLAUDE.md` links them so every agent loads them.
- `ux-patterns` (ux-knowledge) is **not** adopted: it gave no decisions in the test.

## 5. How UI work runs from now on

Every change that touches UI follows Impeccable's loop:

1. **Shape:** a short plan in the PR (user tasks, hierarchy, which DESIGN.md pattern each part uses).
2. **Build** with the barrel pieces only.
3. **Look:** screenshots light and dark through an e2e spec (the spike's `spike-radix-settings.spec.ts` is the model).
4. **Critique and fix**, at most three rounds; the final screenshots go in the PR.

The PR template's UI checklist (guide section 15) gets these four steps.

## 6. Plugins

Plugins get the same Radix pieces through the build toolchain (`toolchain().folders` in `packages/cli/src/plugin-build.ts`, as in the spike). This replaces the plugin kit of guide section 15. The spike found three issues; each gets a fix:

- **Overflow at narrow widths** (~240 px): `plugin check` renders the panel at its narrowest width and fails on horizontal overflow; DESIGN.md gets a narrow-panel rule.
- **Overlays clipped by the iframe:** no Dialog/Popover/Menu inside panels; a panel asks the host to show one through the panel API.
- **Radix's static `<style>` blocked by the panel CSP:** copy those few rules into the panel CSS at build time (or add their hashes to `PANEL_CSP`).

Cost per panel: about +270 KB JS and ~700 KB CSS raw (160 / 83 KB gzip). Accepted (section 9.4).

## 7. Migration order

Each stage leaves the app working; old pieces render fine inside `<Theme>` (seen in the spike), so screens move one at a time.

0. **Evaluate undoing the hand-built guide work** (Part 5 on `feat/sg-forms` and the merged Parts 1–4): what each part changed, what Radix replaces anyway, what is cheaper to revert than to migrate. Marco decides per part before stage 1.
1. Theme + bridge stylesheet + barrel + guard test update; Impeccable, PRODUCT.md, DESIGN.md.
2. Settings (General from spike commit 9d6782e9, then the other tabs).
3. Inicio and Assistant.
4. Secondary pages (Archivos, Historial, Plugins, Jobs, Bandeja).
5. Work screen, zone by zone.
6. Plugins: toolchain, the three fixes, the bundled plugins.
7. Remove the old pieces and their CSS.

## 8. Out of scope

- A separate, reusable "composition layer" project. The test showed most good decisions still came from the agent's own judgment; if DESIGN.md + Impeccable keep producing good screens, it may not be needed. Parked in the queue.
- Specific harnesses (they adopt this in their own repos).

## 9. Decided in review (Marco, 2026-11-04)

Every section was approved as written. The open questions were answered:

1. **Impeccable's launcher** may download and run its binary.
2. **Part 5 (forms) on `feat/sg-forms` stops.** Before the migration starts, evaluate whether the hand-built guide work should be undone (reverted) rather than kept alongside Radix; the evaluation is the first step of the plan (section 7, stage 0).
3. **Pieces with no Radix match** (Option, Tile, StepMark, EmptyState, InlineConfirm) are not rebuilt: the screens that use them are redesigned so they no longer need them.
4. **Plugin bundle cost** (~430 KB raw per panel) is accepted; no shared CSS.
5. **Measures:** adopt Radix's size scale (1–4); the guide's closed heights are dropped.
