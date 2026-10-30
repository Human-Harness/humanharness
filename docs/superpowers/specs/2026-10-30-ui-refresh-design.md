# UI refresh — design

Status: draft for Marco's review (2026-10-30). Mockups: https://claude.ai/artifact/6WpeDVxxusFqaU6rJRH2RS (Design canvas "Human Harness UI refresh", every screen in light and dark; sources are its `project/*.dc.html` files).

**When it is built:** only after `feat/protocol` is merged to master. That branch (replaceable parts plan 2, local tip a39263f) rewrites most of `packages/ui`, so this spec is written against its UI, not master's. Every component name below is as it exists on `feat/protocol`. Writing the plan before that merge is fine; starting the code is not.

This spec replaces the visual parts of the app-look spec (`2026-10-11-app-look-design.md`): its palette, its type and its Settings sheet. Its window rules (fixed window, hidden-inset title bar, top bar as drag region) stay.

## 1. Why

Marco tried the app and found UI problems that are about look and layout, not features:

- Everything is the same gray: a done task, a waiting one and a failed job look alike. The person has to read every label.
- The top bar is a row of loose buttons (meters, toggle, inbox, bell, History, gear) that grows with every feature.
- Settings is a 620px sheet over the chat, with nine tabs. Models, Usage and Plugins don't fit in it.
- Some states are bare words ("Not installed", "OK", "Set") that don't tell the person what happens next or what to do.

The mockups fix this with one style ("soft cards") and one shell for every screen.

## 2. Decisions

- **D1. One token set, two themes.** All colors come from the tokens in §3. Dark is the same set, dimmed. The app still follows the system theme; no theme switch is added.
- **D2. Color means one thing.** Tags are colored by meaning (§3.3), never for decoration. The amber button is the one main action of a screen.
- **D3. One shell.** Top bar + icon rail + content, the same on every screen inside a harness (§4). Home and Setup are the two exceptions (§5.2, §5.6).
- **D4. Settings becomes a page**, not a sheet (§5.5).
- **D5. Every state says what happens next** (§6). This is a rule for all copy, not only for the screens mocked.
- **D6. Search is not in this spec.** The top bar reserves its place (§4.1); what it opens and indexes is the global search spec's (queued).
- **D7. No behavior changes** except the ones listed as "new" in §5. Same data, same IPC, same `client` calls. A feature a harness doesn't declare still shows nothing (D0 of each spec).

## 3. Tokens

### 3.1 Colors

The `--hh-` prefix stays. New names replace old ones; the table says which old token each one replaces, so the plan can rename in one pass.

| Token | Light | Dark | Use | Replaces |
|---|---|---|---|---|
| `--hh-bg` | `#f3f3f1` | `#121315` | Window ground (warm gray) | `--hh-paper` |
| `--hh-rail` | `#fbfbfa` | `#16171a` | Top bar, icon rail, side panels, footers | `--hh-sheet` |
| `--hh-column` | `#f8f8f6` | `#17181b` | Board columns | new |
| `--hh-surface` | `#ffffff` | `#1e2024` | Cards, inputs, chat | same name |
| `--hh-surface-2` | `#f2f2ef` | `#26292e` | Hover, segmented track, code, meters' track | `--hh-segment` |
| `--hh-line` | `#e7e7e3` | `#2a2d32` | Card and panel borders | same name |
| `--hh-line-strong` | `#d9d9d4` | `#383c42` | Hover border, kbd | same name |
| `--hh-ink` | `#1b1c1e` | `#eceef0` | Text | same name |
| `--hh-muted` | `#62656b` | `#a3a8ae` | Secondary text | `--hh-muted`, `--hh-slate` |
| `--hh-faint` | `#8a8d93` | `#80858c` | Separators in text ("/"), hints | new |
| `--hh-cta` / `-ink` / `-hover` | `#fbd38d` / `#3b2a06` / `#f8c76e` | `#f3c56a` / `#2a1d02` / `#f7d184` | The amber main button | `.hh-primary`'s ink fill |
| `--hh-active` / `-ink` | `#fde6b3` / `#7a4f00` | `#3a2e14` / `#f3c56a` | Selected rail icon, selected search row, `mark` | `--hh-highlight` |
| `--hh-logo` / `-ink` | `#1b1c1e` / `#fff` | `#eceef0` / `#121315` | Logo tile | new |
| `--hh-shadow` | `0 1px 2px rgba(20,20,20,.04), 0 8px 24px rgba(20,20,20,.05)` | `0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.25)` | Raised cards, composer, selected segment | new |
| `--hh-backdrop` | `rgba(27,28,30,.18)` | `rgba(0,0,0,.45)` | Behind drawers | same name |

Tag pairs (background / ink), §3.3 says when each is used:

| Pair | Light | Dark |
|---|---|---|
| `--hh-t-green` | `#dff2e5` / `#1d6e3f` | `#17311f` / `#8bd8a8` |
| `--hh-t-orange` | `#fdebd7` / `#a94f08` | `#3a2715` / `#f4b47e` |
| `--hh-t-blue` | `#e4ecfd` / `#2d55c4` | `#1c2944` / `#a3beff` |
| `--hh-t-violet` | `#ece6fb` / `#5f3dba` | `#29223f` / `#c6b4ff` |
| `--hh-t-red` | `#fbe4e1` / `#a3321f` | `#3b1d19` / `#f3a497` |

`--hh-ok`, `--hh-ok-dot` and `--hh-warn` become aliases of the green and orange inks; `--hh-error-bg` of `--hh-t-red`. The callout, review, diff and profile tokens are not in the mockups: they keep their names, and the plan checks each one's contrast on the new grounds (WCAG AA for text) and adjusts the values that fail.

`plugin-ui/tokens.css` is a copy of these tokens for plugin panels, pinned by `plugin-ui-tokens.test.ts`. It changes in the same commit. Old names stay there as aliases for one release, because published plugins may use them.

### 3.2 Type, radii, sizes

- **Font: DM Sans** (weights 400, 500, 600, 700), for UI and display. It replaces the system font and Lexend. It is bundled with the app (OFL license, woff2 in the renderer), never loaded from Google Fonts: the renderer's CSP blocks remote fonts and the app works offline. Code stays `ui-monospace`.
- **Base size 14px** (today 13px). The ⌘+ / ⌘− text size keeps working on top of it.
- Scale: page title 28px/600, Home name 40px/600, panel title 20px/600, card title 15.5px/600, body 14px, secondary 13px, section label 12px/600 uppercase.
- **Radii:** tag and chip 7–8px, pill button 11px, icon button and CTA 12px (Home CTA 14px), card 14px, large card and board column 16px, dialog 18px.
- **Hit targets:** icon buttons 44×44, pills 40px high (34px inside dense cards), CTA 44px (52px on Home), rows 52px. The chamfered `.hh-start` button goes away: every main action is the amber CTA.

### 3.3 Tags by meaning

| Color | Means | Examples from the mockups |
|---|---|---|
| Green | Done, ready, on | Done, Note saved, Ready ✓, Stored, On, Light (tier) |
| Orange | Now, waiting for you, close to a limit | Waiting for you, Your turn, Now, Up next, Needs you, Close to your limit, Before you send |
| Blue | Information, in progress | Running/Working, Has a question, Read only, Standard (tier), Next prompt |
| Violet | Deep, suggestion | Deep (tier), Jobs column, Worth knowing, Decision callout |
| Red | Failed, needs fixing | Failed, Turned off after crashes, a conflict between tasks |
| Gray (`surface-2`) | Neutral, not started | Queued, To do, counts, No changes |

Model tiers always use the same colors: Light green, Standard blue, Deep violet. A **tag** has a colored fill; a **chip** (white, bordered) is a thing, not a state: a file, a phase not reached, a count.

## 4. The shell

### 4.1 Top bar

One bar for every screen inside a harness, on `--hh-rail` with a bottom line. From left to right:

1. **Logo tile** (44px, the harness logo or the HH tile). The bar keeps its macOS role: it is the window's drag region and leaves 80px on the left for the traffic lights, so the logo starts after them.
2. **Breadcrumb**: harness name / screen ("Demo / The turn", "Demo / Settings / Models"). Each part but the last is a link.
3. **Search trigger** (center, up to 560px): a field-looking button with "Search tasks, notes, files, settings…" and ⌘K. It only opens the search dialog; everything about the dialog belongs to the search spec. Until that spec is built, the trigger is not shown (no dead button).
4. **Inbox pill** with the count of tasks waiting for you (orange tag), only for a harness with `parallel`. Not shown on the Inbox screen itself.
5. **Notifications bell**: the plugins' attention inbox, as today.
6. **Profile avatar**: the active profile's initial on its profile color. It opens the profile switcher. Only for a harness with profiles.

What leaves the top bar: the context meter, usage meter, plugin chips, Sidekick toggle, History button and the gear. They move to the task header (§5.1) or the rail (§4.2).

Changes: `chrome.tsx` `TopBar` gets the slots above (logo, breadcrumb, search, trailing). `ChatView` stops filling it with its own controls. `parallel/Inbox.tsx` keeps its count and becomes the pill; its list becomes the Inbox screen (§5.4). `plugins/AttentionInbox.tsx` stays as the bell, restyled. `ProfileSwitcher` opens from the avatar.

### 4.2 Icon rail

A 76px column on the left, on `--hh-rail`, with 44px icon buttons; the selected one uses `--hh-active`. Top group: **Home, Tasks, Inbox, Jobs, Notes, Plugins**. Bottom: **Settings**. Each icon has a label (`aria-label` and a tooltip).

- An entry shows only when the harness has the feature: Inbox and Jobs need `parallel` (Jobs needs declared jobs), Notes needs notes, Plugins needs a running plugin with a panel. A plain harness shows Home, Tasks and Settings.
- Tasks is the chat or the start view. Notes opens the Notes drawer (§5.7). Plugins opens the plugins section that `PluginsSection` shows today. Jobs opens the Inbox screen scrolled to its Jobs column.
- Under 760px wide, the rail becomes a horizontal row under the top bar.

New component: `Rail` in `chrome.tsx`. It replaces the "Home" button and the gear in the top bar.

### 4.3 Side columns

Side columns (flow side, Sidekick, drawers) use `--hh-rail`, the same ground as the rail, with a 1px line on the inside edge. The content area is `--hh-bg` with white cards on it. That contrast is what makes the screen read as "tools on the sides, work in the middle".

## 5. Screen by screen

Each screen lists what changes in an existing `packages/ui` component and what is new.

### 5.1 Chat (flow mode)

Layout: shell + flow side (290px) + main + Sidekick column (280–320px).

**Flow side** (`FlowSide.tsx`, restyled):
- Header: harness kind and name ("Demo harness / Architecture explainer").
- **Guided path**: numbered steps; a done step shows a green ✓ mark and a green "Done" tag, the current one an amber mark, a white card and an orange "Now" tag; the count "2 / 6" sits by the heading.
- **What's clear so far**: one small card per note, with the files it cites as chips ("+2" for the rest).
- **Material**: the reference folder as a card with a blue "Read only" tag.

**Task header** (new, in `ChatView`): title (28px) and "Topic 3 of 6 · started 12 min ago", then pills: **Context 42%** (`ContextMeter`, opens the context panel), **usage** (`UsageMeter`, "Claude · 18% this week"), **Sidekick** (`SidekickToggle` as a pill with a state dot), **History**, and the amber **New task** CTA. Plugin chips (`PluginChips`) go in the same row, before History.

**Task tabs and phases** (`parallel/TaskStrip.tsx` changes): the thin strip becomes a row of tabs, one per open task, with an orange dot on a task waiting for you. The phases (`PhaseStepper`) sit on the right of that row as tags: done green, current orange, not reached as a chip.

**Conversation**: one white card holding the messages (`Message`). The assistant's answer is a card with the files it read as chips on top ("+3 files read"). `ChoicesBlock` options become 52px rows, each with a tag naming its kind (Next orange, Deeper blue, Ask violet); the recommended one has an amber border.

**Composer**: a raised white card: textarea, then attach, the tier pill ("Standard ▾"), "⏎ to send" and the amber **Send**.

**Sidekick** (`sidekick/SidekickPanel.tsx`, restyled): heading with a green "On" tag and an options button; each card starts with its tag: "Before you send" orange, "Next prompt" blue, "Worth knowing" violet; actions are pills ("Split it", "Dismiss", "Use it").

### 5.2 Home

Home keeps its own frame, no rail: a small header (logo, gear), a centered column, the footer with the folder path on `--hh-rail`.

`Home.tsx` changes: the 84px logo tile with shadow, the name at 40px, the tagline, the amber **Start <harness>** CTA (52px, arrow) instead of the chamfered button, and the engine pill: green dot, "Claude Code · Connected · 5-hour · 18%". The pill opens Settings › Engine. The missing-setup sections, the language offer and the backup notice keep their logic, restyled as cards.

**New: "Pick up where you left"**, under the engine pill, with a count. Up to three recent tasks as cards: a status tag, the task title, and a line with where it is and when ("Topic 3 of 6 · 12 min ago", "Note saved · yesterday"). A click opens that task. Source: the open tasks (`useTasks`) for a harness with `parallel`, else the history's latest tasks (the data `HistoryPanel` reads). Hidden when there are none, and on a Home that isn't ready (setup missing, no engine).

### 5.3 Start view

`StartView.tsx` changes:

- Header: "Demo · How Human Harness works", the question as the page title ("Which part do you want to understand?"), the harness's intro line; the usage and History pills on the right.
- **Guided path** heading with "2 / 6 done".
- **New: Cards / List switch.** Cards: the current `.hh-topics` grid, each card with a status tag (Done green, Up next orange, To do gray), a tier tag (Standard blue, Deep violet), its number and description; the next topic has an amber border. List: one 52px row per topic with the same tags. The choice is remembered per harness.
- **"Or ask straight away"**: the frequent questions as pills.
- **Free question** card: input, a gray "Free question" tag, amber **Send**.
- A muted line under it says how the AI answers and that it can be wrong.

### 5.4 Inbox and jobs as a board

**New screen** (rail › Inbox). It replaces the drop-down list of `parallel/Inbox.tsx`; the list's data and actions stay.

- Header: "Inbox", a summary line ("2 waiting for you · 1 working · 3 jobs"), a **List / Board** switch (Board by default; List is today's four sections) and the amber **New task**.
- Board columns on `--hh-column`, each headed by its state tag and a count: **Waiting for you** (orange), **Working** (blue), **Queued** (gray), **Jobs** (violet).
- A task card: title, its reason as a tag ("Your turn", "Has a question") plus the phase chip, a line, then its tier tag and "Waiting 4 min". A working task shows what it does ("Reading 3 files") and a progress bar. A queued task says when it starts ("Starts when a slot frees up · 2 tasks at once").
- A conflict between tasks (parallel spec's same-file notice) is a dashed card in the Working column with a red warning line and the file.
- A job card (`parallel/JobsTab.tsx` data): name, result tag, "Every 1 h · Last run 10:02 · Next run 11:02", and its one action as a pill: Run now, Open (needs you), Resume (paused).

Settings › Jobs keeps per-job settings (on/off, daily cap) and is restyled with the page components.

### 5.5 Settings as a page

`SettingsSheet.tsx` becomes **`SettingsPage`**: a full screen, not a sheet over the chat.

- Top bar: breadcrumb "Demo / Settings / Models", the search trigger, and the amber **Done** that goes back to where the person was. Escape does the same.
- Left: a 240px section list on `--hh-rail`, the "Settings" title on top. Sections in today's order: General, <harness>, Engine, Models, Sidekick, Plugins, Connections, Jobs, Usage. A section that needs attention carries an orange count (Plugins "1").
- Right: the section, max 860px wide. Each section starts with its title and one line that says what it is for and when a change applies ("Changes apply from the next task").
- Rows inside cards: label and hint on the left, control on the right (segmented control, switch, select, pill).

Per section (General, the harness tab and Jobs are not mocked: same components):

- **Models** (`ModelsTab.tsx`): a "Tasks" card, one row per task with Light / Standard / Deep / Custom, the hint "Recommended: Deep" or, when changed, "Changed · recommended: Standard" in orange with a **Restore** pill; "Restore recommended" for all. A "Levels" card with an engine switch and a table (level tag, model, effort, used by, Edit); under it, "If your plan doesn't include a model, the task uses the level below and tells you." A "Pinned files budget" card with a select.
- **Sidekick** (`sidekick/SidekickTab.tsx`): the main switch in the header; three stat cards (tokens this week, suggestions used "12 of 19", model with a link to Models); "When it helps" switches and the wait and cap segments; "What Sidekick learned" (`LearnedList`) with an About you / In this app switch, each item with a kind tag, Edit and Forget this; "Not flagged" chips to flag a kind again.
- **Plugins** (`plugins/PluginsTab.tsx`, `PluginDetail.tsx`): list on the left, each plugin with its source line and status tag; the selected one's detail on the right: what it may do (hosts, keys, agent tasks) as chips, keys, connection test, notify switch, last errors, Reset and a red Remove…
- **Engine** (`EngineTab.tsx`): the engine in use as a card (In use, Ready ✓, plan, where data goes, version with "Check again", terms links, Sign out); "Other engines" as cards, each with what it needs, its state with the next step, and "Use <engine>".
- **Connections** (`connections/ConnectionsTab.tsx`): one row per key with who uses it, its state, and Test / Replace, or a password field and **Save** when not set; the note that keys are kept encrypted and never shown again.
- **Usage** (`UsageTab.tsx`): "Your plan now", one card per window with percent, bar, an orange "Close to your limit" tag past 75%, and when it renews; "How much each topic uses" with a 5 h / week switch and a table (use tag, share, "Enough for about 5 times"); background jobs and material processing on a line under it.

### 5.6 Setup

`SetupFlow.tsx` keeps its own frame: header with the logo, "Set up Demo" and **Cancel**; a step list on the left (done steps with a green ✓ and their value, "Step 2 of 2" under the current one); the step on the right.

Engine step (`EngineOnboarding.tsx`): the engines as radio tiles (logo tile, name, maker, what it needs, a status line with a dot). The selected tile has an amber border. "One last check" card: plan, where data goes, the ready line and the legal links. Footer: "You can change all of this whenever you like in Settings.", **Back**, amber **Next**. The other steps (folder, profile, harness steps, interview) use the same frame and components.

### 5.7 Drawers: history, notes, reader

History and Notes open as **drawers** from the right: 480px, on `--hh-rail`, over a `--hh-backdrop` scrim, with a header (title 20px, one subtitle line, close). One drawer at a time, as today; Escape closes it.

- **History** (`HistoryPanel.tsx`, 380px fixed panel today): the subtitle "Go back to any point: your files return to how they were then."; an All / Tasks / Outside a task switch; days as section labels; each task a card with its status tag ("In progress" blue, "Note saved" green), its time span and files changed, file chips, and "Undo this task". An expanded task lists its points with a dot (green for the AI finishing) and "Go back here" on hover. A turn outside a task with nothing changed shows a gray "No changes".
- **Notes** (`NotesPanel.tsx`): title "What's clear so far" and "2 topics summarized"; a green line on top saying what the notes are for; each note a card with "N key points" (blue), its points, "Pick this topic up again" and "Open the file"; a muted line at the bottom saying where notes are kept.
- **Reader** (`DocumentReader.tsx`): stays a docked column beside the chat (today's `hh-reader`, 55%), restyled: header with title and "Document · notes/turn.md", **Aa** (reading preferences) and **Full screen**; tags on top of the document (Updated green, read time, author gray); the decision callout in violet; tables and code on `surface-2`; footer with path and change time, **Source** and **Show chat**. The serif option stays in Aa.
- The context panel (`ContextPanel.tsx`) and the file timeline (`FileTimelinePanel.tsx`) are not mocked: they use the drawer frame.

## 6. Copy rule: every state says what happens next

A status never stands alone. Each one says, in the tag or in the line next to it, **what happens next or what the person can do**. A bare "Not installed", "OK" or "Set" fails the rule.

| Bare | With what's next |
|---|---|
| Not installed | Not on this computer yet · we install it next |
| Installed | Installed · pick a provider to use it |
| Queued | Starts when a slot frees up · 2 tasks at once |
| Failed | Paused until tomorrow · daily token cap reached · Resume |
| OK (job) | OK · Next run 11:02 |
| Not set (key) | Not set · paste the key to use On this day |
| Turned off | Turned off after crashes · turn it on to try again |
| Close to your limit | Close to your limit · renews Monday 09:00 |
| Waiting | Waiting for you · 4 min |

How to apply it:

- A tag can stay short when the line beside it carries the next step (the job card's "Next run 11:02"). The pair is checked together.
- The next step is concrete: a time, a condition or an action the person can take on the same card.
- It applies to every string in `packages/i18n` that names a state, not only the screens mocked. The plan lists the strings it changes.
- Mockup copy that breaks the rule is fixed in the build, not copied: the job "OK" tag, the connection "Not set" and the plugin "Turned off after crashes" lines above.

## 7. What stays the same

- All behavior, data, IPC and `client` calls, except the new items: "Pick up where you left", Cards / List, the Inbox board, Settings as a page, the rail.
- Accessibility already in place: labels, focus return, Escape, `aria-current`, focus rings (now drawn in `--hh-ink` on the new grounds, inside the amber CTA).
- D0 for every feature: a harness without `parallel`, profiles, plugins or Sidekick shows none of their pieces.
- The text-size shortcuts and the language-on-demand strings.

## 8. Out of scope

- Global search: what it indexes, the ⌘K dialog, the "ask the AI" action. Own spec (queued). The mockup "Search (⌘K)" is its input.
- Any code in this spec's branch.
- A manual light / dark switch.
- New features beyond the ones in §7.

## 9. Testing

- `styles.test.ts` and `plugin-ui-tokens.test.ts` pin the new token values in both themes.
- A contrast check over every tag pair and text token on its grounds, light and dark (AA).
- Component tests: rail entries per declared feature (D0), Home "Pick up where you left" sources and hiding, Start view switch remembered, Settings page open / Done / Escape returning to the screen it came from.
- e2e: the existing flows still pass with the new selectors; one screenshot per screen and theme, compared with the mockups by eye in the plan's review.

## 10. Open questions (defaults proposed)

- **Q1. Search trigger before search exists.** Default: hidden until the search spec ships. Alternative: shown, opening a stub that searches tasks only.
- **Q2. Profile avatar without profiles.** Default: not shown. Alternative: a generic avatar opening Settings › General.
- **Q3. Reader: docked or drawer?** The mockup draws it as a 760px panel over the chat with "Show chat". Default: keep it docked beside the chat (today's behavior, chat stays usable), with the mockup's look. Alternative: drawer over the chat.
- **Q4. Status names differ between mockups** ("Running" on Home, "Working" on the board, "In progress" in History). Default: "Working" everywhere for a task the AI is on.
- **Q5. Inbox default view.** Default: Board. Alternative: remember the last one.
- **Q6. Plan split.** Proposed order: (1) tokens + DM Sans + type scale; (2) shell: top bar, rail, side columns; (3) chat and start view; (4) Home; (5) Inbox board; (6) Settings page; (7) drawers and setup; (8) copy pass (§6). Each one a PR, stacked.
