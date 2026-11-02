# Closed-world style guide — design

Date: 2026-11-02
Status: written from the approved guide, waiting for Marco's review
Source: the guide artifact https://claude.ai/artifact/2j18xQrjeqXPLnYaKuDkfL (v28) and the decisions page https://claude.ai/artifact/XbHnScLhQXDTCAvUTv6aDD. Every rule below was decided by Marco on those pages; this spec only restates them in English and adds how to build them.
Builds on: `2026-10-11-app-look-design.md`, `2026-10-30-ui-refresh-design.md`, `2026-10-30-global-search-design.md`, the Sidekick spec, the document reader spec.

## 1. Goal

Every screen of every harness (the demo included) is built from a fixed set of pieces with fixed measures. Nothing is designed per case.

- **Closed world.** If a piece is not in this guide, it cannot appear on any screen. A loose character (✓ ← × › ✕ ↩) never stands in for an icon.
- **Each zone of a screen has a closed list of contents** (section 10). What is not on a zone's list does not go there.
- **A harness may change values** (colors, type, radii, measures) — always through tokens — and **add templates** for its own screens, built from guide pieces. It may not move the fixed parts of the core templates, add tokens, or use a loose color.
- **A chat block of a harness** may add a drawing with its own CSS, using tokens only (section 15).
- **A new piece** enters only as section 15 says: Marco decides on a decision page, and one PR changes code and guide together.
- **Code is the source of truth.** Once implemented, the guide is generated from the code (section 16).

## 2. Measures

No screen uses a loose number. Today there are heights of 16, 18, 22, 24, 26, 28, 30, 32, 36, 44, 48, 52 and 104 and radii of 4, 6, 8, 12, 14, 24 and 999; only the values below stay.

### Heights (closed)

| Height | For this and nothing else |
|---|---|
| 18 | Counter, checkbox, radio |
| 24 | Tag, step mark, avatar in the top bar |
| 30 · compact | Button, field, select, chip and segmented inside the top bar, the task header, cards and rows |
| 40 · normal | Top bar, button, field, select, tab, nav item |
| 52 | List or settings row, option, large button |
| 104 | Tile (large option with logo or description) |

### Widths (closed)

| Token | Value | For |
|---|---|---|
| `--hh-rail-w` | 64 (today 76) | Left rail |
| `--hh-column-w` (new) | 280 (min 220 · max 320) | Side columns of the work screen, Settings nav, Assistant nav |
| `--hh-split-w` (new) | 55 % | Split view (reader, context) |
| `--hh-read-w` | 680 | Reading column: chat, document, text pages |
| `--hh-dialog-w` | 440 · 640 (search) | Dialogs |
| `--hh-popover-w` | 320 | Top-bar popovers |

### Radii and spacing

| Radius | For |
|---|---|
| 8 | Everything compact: tag, chip, 30 button, step mark, items inside a card |
| 12 | 40 controls, grouped rows, notices, confirmations, options |
| 14 | Cards, tiles, large button |
| 18 | Dialogs |
| round | Only dot, avatar, toggle, counter and progress bar |

Spacing: 4 · 8 · 12 · 16 · 24 · 32. Nothing else.

### Type (DM Sans · DM Mono)

| Role | Size / weight | Where |
|---|---|---|
| App name | 28 / 600 | Only the app name on Inicio. 40 goes. |
| Panel title | 20 / 600 | Task title, secondary pages, dialogs, assistant steps, Settings nav |
| Reading text | 16 / 400 | Only the reader document |
| Card title · chat reply | 15 / 600 and 15 / 400 | |
| Body | 14 / 400 | |
| Secondary text, compact button | 13 / 400 · compact button 13 / 500 | |
| Section label · caption | 12 | The minimum. 11, 17 and 18 go. |
| Inline code | DM Mono 400, one point below the surrounding text, `surface-2` background, radius 4 (new) | Commands, paths, file names inside a sentence |

Weights: 400 text · 500 button and chip text · 600 titles, labels and tags. 700 goes. DM Sans for everything; DM Mono only for code (inline and blocks) and keys.

### Color (closed, light and dark)

Every color in the app is one of these tokens. A harness may change any value, light and dark, always by token; it cannot add tokens or use a loose color.

| Token | Light | Dark | For |
|---|---|---|---|
| `--hh-bg` | #f3f3f1 | #121315 | Window background |
| `--hh-rail` | #fbfbfa | #16171a | Rail |
| `--hh-column` | #f8f8f6 | #17181b | Side columns |
| `--hh-surface` | #ffffff | #1e2024 | Cards, dialogs, fields, buttons |
| `--hh-surface-2` | #f2f2ef | #26292e | Grey fill: hover, segmented, code, grey tag |
| `--hh-line` | #e7e7e3 | #2a2d32 | Borders and separators |
| `--hh-line-strong` | #d9d9d4 | #383c42 | Hover border, dim dot |
| `--hh-ink` | #1b1c1e | #eceef0 | Text and icons |
| `--hh-muted` | #62656b | #a3a8ae | Secondary text, idle icons |
| `--hh-faint` | #8a8d93 | #80858c | Placeholder, dim mark |
| `--hh-cta` | #fbd38d | #f3c56a | Primary button |
| `--hh-cta-ink` | #3b2a06 | #2a1d02 | Primary button text |
| `--hh-cta-hover` | #f8c76e | #f7d184 | Primary button hover |
| `--hh-active` | #fde6b3 | #3a2e14 | The chosen thing: item, chip, segment, search match, active review mark |
| `--hh-active-ink` | #7a4f00 | #f3c56a | Text on the chosen thing |

The five tag colors (background + ink):

| Color | Light | Dark |
|---|---|---|
| green | #dff2e5 / #1d6e3f | #17311f / #8bd8a8 |
| orange | #fdebd7 / #a94f08 | #3a2715 / #f4b47e |
| blue | #e4ecfd / #2d55c4 | #1c2944 / #a3beff |
| violet | #ece6fb / #5f3dba | #29223f / #c6b4ff |
| red | #fbe4e1 / #a3321f | #3b1d19 / #f3a497 |
| grey | `surface-2` + `ink` in both themes | |

Plus `--hh-shadow` (cards and layers) and `--hh-backdrop` (dimmed background behind a dialog). Nothing else.

**Special uses take only the tag colors:**

- Markdown callouts (Note, Tip, Warning, Summary, Decision, Question): tag colors.
- Diffs: lines with green (added) / red (removed) background and border; words inside a line with green background, red background struck through. The Sidekick uses the same. Segmented Inline / Side by side (side by side becomes inline below 900). Markdown is always compared as lines.
- Review marks: background + 2 px underline in the type's ink. Question orange · comment blue · resolved grey · the active one in `--hh-active`. Margin dots (focus mode) use the type's color.
- Profile avatars: six — green, orange, blue, violet, red, grey — with their tag ink.

**Tokens that go:** `--hh-callout-*` (6), `--hh-review-*` (4), `--hh-diff-*` (4), `--hh-profile-*` (8; coral, turquoise and pink disappear), `--hh-highlight` (becomes `--hh-active`). Any other color token in `styles.css` not in the tables above also goes or maps to one of them.

## 3. Buttons and ways to choose

### Button types

| Type | Normal (40) | Compact (30) | When |
|---|---|---|---|
| Primary | Continuar | Continuar | One per screen, dialog or card. Always last on the right. |
| Secondary | Cancelar | Cancelar | Everything else. Left of the primary. |
| Quiet | Ver más | Ver detalles | Low-weight actions in cards and rows; expand and collapse; every top-bar button (icons and Sidekick). Never inside a notice. |
| Danger | Borrar | Quitar | Delete, disconnect. Alone, far left. Always asks for confirmation. |
| Icon | | | Square, no text, always with a tooltip. Only the icons and places of section 4. |
| With icon | Nueva tarea | Historial | Icon left of the text. Only the icon+text pairs of section 4. |
| Large (new to the guide) | Empezar | | 52 px. Only the Inicio action and the end of the Assistant. |
| Link | términos de uso | | Only inside running text, never as a standalone action. |

States: normal, hover, focus, disabled, and busy ("Guardando…" with the loading icon).

### One-line bars (new)

The task header (zone 3) and the phase and mode bar (zone 5) never wrap to two lines. When width runs out, buttons compress right to left in this order:

1. As they are (secondary with border, primary amber).
2. No border or fill: all become quiet, with icon and text.
3. No text: quiet icon buttons with tooltip — only those with an icon+text pair in section 4.
4. One More button (⋯, quiet icon) that opens a menu with every action as text, same order.

Buttons without an icon jump from step 2 to step 4. The title is never cut to make room; it ellipsizes only if step 4 is not enough. Buttons never stack or wrap.

### Ways to choose

| Piece | When |
|---|---|
| Segmented (30) | One of 2–4 short options that change the view or a value. Also replaces button groups (text size, weekdays). |
| Tabs (40) | Open things of the same kind: parallel tasks; Notas · Referencias · Material in Archivos. Orange dot = waits for you. |
| Nav item (40) | Vertical navigation: Settings, assistant steps, walkthrough. May carry a step mark or a counter. |
| Option (52) | One among options with a description: chat options block, mode list, backup places, languages, engine. Amber border = recommended. |
| Tile (104) | Only the topics at task start. Selected = 2 px dark border, no check. |

### What happens to today's buttons

| Today | Where | Becomes |
|---|---|---|
| `.hh-pill` | Historial, Sidekick, context meter, engine on Inicio, Restaurar in Modelos | Compact secondary, or chip if it shows a state |
| `.hh-cta`, `.hh-primary` | Enviar, Nueva tarea, Guardar… | Primary (only one) |
| `.hh-link` as action | Ver todo, Editar, plugins Back, Saltar | Quiet |
| `.hh-tk-cancel` (11 px), 24 px buttons of the demo and plugins | Jobs, demo, plugin kit | Quiet or compact secondary |
| `a.hh-button` | Soporte, Ver planes | Secondary (opens outside) |
| `.hh-text-sizes`, `.hh-pl-days` | Settings, plugin schedule | Segmented |
| `.hh-tk-tab` (44) and `.hh-pl-tab` (24) | Parallel tasks, plugin panels | Tabs (40) — see open question 3 |
| `.hh-choice` (36 and 52), `.hh-place`, `.hh-langpick-option` | Chat, modes, backup, language | Option (52) |
| `.hh-engine-radio` | Engine | Option (52) |
| `.hh-tile`, `.hh-topic` | Start topics | Tile |
| `.hh-settings-navitem`, assistant steps, `.hh-flow-step` (44) | Settings, Assistant, walkthrough | Nav item (40) |

## 4. Icons

One style: line, no fill, 24 box, 1.75 stroke, round caps, color of the surrounding text. Three sizes: 14 (inside text, tags, rows), 18 (buttons, top bar, rail, nav), 32 (empty states). Today there are 9 sizes, 6 stroke widths, a GIF and 7 characters used as icons.

| Icon | May only appear in |
|---|---|
| Inicio, Tareas, Bandeja, Jobs, Archivos, Plugins | The rail (18). The same at 32 in their page's empty state. |
| Nota | Rows of the Notas tab in Archivos (14) and its empty state (32). |
| Settings | Right corner of the top bar, except in Settings. The Save icon goes: changes save themselves. |
| Avisos (bell) | Top bar, if plugins have notices. |
| Buscar | Quiet icon button in the top bar next to ⚙ (tooltip "Buscar (⌘K)"); inside the search field and filter fields. |
| Cerrar | Header of a dialog and of the split view. Nowhere else. |
| Volver | Left of the top bar, on secondary pages and Settings, inside the compact quiet button "← name". One per screen: from a detail it goes to the list; from the list, to where you came from. |
| Seguir | Only inside the large button. |
| Agregar | Next to the text in "Nueva tarea", "Nueva nota", "Agregar…". |
| Historial, Deshacer | Historial button in the task header; "Volver a este punto" on the Historial page. |
| Desplegar (chevron) | Foldable rows (work steps, tools, history days) and collapsing the right column. Rotates 90° when open. |
| Más (⋯) | End of a row or card with more than two actions; step 4 of one-line bars. Opens a menu. |
| Listo (check) | "Listo" tag, done step mark, chosen tile (14). |
| Atención, Info | Start of a notice or status line (14). |
| Solo lectura (lock) | Rows of the Referencias tab in Archivos (14). |
| Pantalla completa, Texto | Header of the reader split view. |
| Motor | Motor item in Settings and the engine tile when there is no logo. |
| Cargando (new) | Replaces the GIF. Inside a waiting button and in "Trabajando…". Static under reduced motion. |
| Nota, Consejo, Atención, Resumen, Decisión, Pregunta | Only in markdown callouts (`> [!tip]`…), at 14. |
| Coach, Foco, Guardián, Mentor, Resumen del día (new) | Only inside a sidekick mark (24 circle, 14 icon): status line, cards, folded column, Settings › Sidekicks. A custom sidekick picks one of these or any set icon; never an emoji or an image. |

Marks — not icons, each with a fixed place:

| Mark | Place |
|---|---|
| App logo | Inicio (84) and footer |
| Engine logo (image) | Engine option (32) and engine chip on Inicio (18) |
| Sidekick mark | 24 circle with a set icon: status line and cards of the Sidekick, folded column, Settings › Sidekicks |
| Avatar (initial) | Top bar (24), profile rows (32). Replaces the Conexiones "letter". |
| Separators "/" and "·" | Typography: top-bar crumbs and metadata |

Gone: ✓ (engine tile, phases), ← (plugins Back), × (remove row, remove material), ✕ (drawer), › (collapse Sidekick), ↩ (footnotes → "volver" as text), the second 14 px arrow, and the GIF.

## 5. Form controls

Field, select and textarea measure the same as the button next to them (40, or 30 compact). Number, password and time fields, textareas and checkboxes get the field style (today they have browser styles).

| Control | When |
|---|---|
| Toggle (20 × 34), the only one | Turn on or off something that acts at once: a plugin, a notice, the Sidekick. Today's three forms merge into this. |
| Checkbox (18) | Only to accept something before going on. Several from a list = toggles, one per row. |
| Radio (18) | Only inside a 52 option. Never loose, not in a form either. |

Choosing rule: 2–4 short values → segmented · with description → options · more than 6 → select · yes/no → toggle.

### Form: label on top (new)

Used in the Assistant, chat form blocks and editors. The settings row keeps the label on the left.

| Part | Form |
|---|---|
| Label | 14 / 600 above the field, 8 gap. Required fields get a red asterisk; optional ones no mark. |
| Help | 13 grey below the field, one line. |
| Error | 13 red with the attention icon, below its field; the field border turns red. Never an error list on top. |
| Spacing | 24 between fields. Field is full width up to 680. |

### Field types (closed list; a harness declares only these 12)

| Type | Form |
|---|---|
| Text | Field of 40 (30 compact). |
| Number | Field with min and max; optional unit after it, grey. |
| Textarea | At least 3 lines. |
| One of several | Segmented, 52 options or select, per the rule. Never loose radios. |
| Several from a list | Toggles, one per row (compact rows). No loose checkboxes. |
| Yes / no | Toggle (settings) or checkbox (accept before going on). |
| Secret | Hidden field + one button (Guardar when empty, Reemplazar when set) + More (⋯) with Borrar and Probar. |
| Folder or file | Path as inline code + Elegir… |
| Key-value pairs | Rows of two fields with remove (Cerrar icon) and a borderless Agregar at the end. |
| Slider | One value in a range, full width; min, max and step declared. |
| Date | Field with a calendar picker. |
| Color | Swatch + code + Cambiar. For a harness to pick its accent. |

### Settings row (52)

Text left (label 14 + help 13), control right, compact. A field error is a red status line under the label. Read-only data uses the same row with no control: the value as a grey tag on the right. If the chosen value is not the recommended one, "Recomendado: …" in 12 grey goes under the control — no tag, no Restaurar, nothing when it matches.

## 6. Indicators

Pieces that show a state and are not touched (except the chip). A tag is a state and has color. A chip is a thing and is white with a border.

| Piece | Rule |
|---|---|
| Tag (24) | Color always means the same: green = done, active, in use · orange = your turn, about to run out, next · blue = in progress, kind of learned thing · violet = model level (light green · standard blue · deep violet) · red = error · grey = pending, off, test mode (replaces the "mock" badge). Weight 600. |
| Chip (30) | Clickable when it opens what it names (document, context) or sends a ready question (FAQ). Replaces `.hh-pill`, plugin chips (24 / 11 px), reader and review chips. |
| Counter (18) | On a rail or top-bar icon, or next to a nav item. Replaces `.hh-pl-badge` and the Bandeja pill. |
| Dot (8) | Ready · waiting · off · error. Next to a name (engine, Sidekick, tab, notice). |
| Step mark (24, radius 8) | Assistant steps, walkthrough, missing steps on Inicio. Replaces today's three (18, 26, 26 square). |
| Progress bar (6) | Plan usage, Bandeja rows, Sidekick. Orange near the limit. |
| Ring (16) | Only context usage, inside its chip. |
| Avatar (24 · 32) | Profile in the top bar and in lists; connection letter. |
| Table (rows 40) | Data in columns: usage, markdown. Header 12 grey. |

### Card (new)

| Part | Form | Allowed content |
|---|---|---|
| Frame | `surface`, `line` border, radius 14. Padding 16 in lists, columns and chat; 24 in Settings and the Assistant. 12 between parts. | The parts below, in this order. Never a card inside a card. |
| Eyebrow (optional) | Section label 12 / 600, uppercase, grey. | One or two words placing the card ("Paso 2"). |
| Header | Title 15 / 600 on the left. | On the right, only a tag (the state). No button or segmented: a control drops to the card's first row. |
| Body | Text 14, rows, fields, tables. | Pieces from sections 5 and 6. |
| Actions (optional) | One line at the end, right-aligned, primary rightmost. Always compact (30). | Up to 2 buttons: one primary and one secondary. Anything else goes to More (⋯). |

## 7. Messages

Four ways to say something, each in four tones: error = red · attention = orange · info = grey · ok = green. Colored background only on the notice; the status line changes only the text color. No toasts.

| Piece | When |
|---|---|
| Status line | Result of an action, next to it. A field error. A state that changes on its own. |
| Notice | Something that needs attention in a zone, with up to two compact buttons: secondary with border only, transparent fill and the notice's color, or one primary if it is the key action. Never quiet. Sits above what it affects. |
| Inline confirmation | Before something heavy or irreversible, inside the flow (chat, row). Escape closes. Today's four (pre-flight, level, time, mode) use it. |
| Empty state | A list or page with no content. The page icon at 32, title, one sentence, at most one primary action. |

## 8. Overlays

Closed list. Nothing else goes on top of anything. There are no side drawers: what is a drawer today becomes a page or a split view.

| Piece | Form | Opened by | Allowed content |
|---|---|---|---|
| Dialog | Centered, 440, radius 18, dimmed backdrop. Header: title 20 + Cerrar. Footer: danger left; secondary and primary right. | Pick language, translation notice, translation progress, confirm something destructive. | Text, fields, a list of options, status line. |
| Search | Dialog of 640, at 12 % from the top, no Cerrar. | ⌘K or the top-bar search icon | See below. |
| Popover | 320, radius 12, hanging from its button, top bar only. | Avatar (switch profile), bell (plugin notices). | Rows with dot, title and one quiet action. |
| Menu | Popover with a list of actions. | More (⋯), reader text settings. | Text actions, danger last. |
| Tooltip | The system one (`title`), plus one custom tooltip on annotation marks. | Hover or focus | One sentence. |

### Search (⌘K)

| Part | Form | Allowed content |
|---|---|---|
| Frame | Modal 640, radius 18, 12 % from the top, dimmed backdrop. Closes with Esc, ⌘K or a click outside. Focus is trapped. | The four parts below, in order. |
| Field | 56 tall (see open question 1), text 16, no own border; a line below. Search icon left; "Esc" hint right. | Placeholder "Buscar tareas, notas, archivos, settings…". |
| Filters | One line of 30 chips, never two; scrolls sideways if needed. Chosen one in `--hh-active`. | "Todo · N" and one chip per type with results, with icon and count, fixed order: Tareas, Notas, Archivos, Settings, Acciones, Datos (only if the harness turns it on). ⌘1…⌘7 pick them. |
| Results | Groups with 12 uppercase titles; 52 rows with type icon (grey), title with the match marked, one 13 context line and an optional grey tag on the right. Chosen row has a grey fill. "Todo": up to 5 per group; filtered: up to 50. | Only the filter types. The tag only says "solo lectura" (reference folder) or when (past task). No buttons in rows. |
| Footer (new) | One line of shortcuts, 12 grey, keys boxed. | ↑↓ moverse · Enter abrir · ⌘Enter preguntar a la IA · Esc cerrar. No buttons. |

States: empty (up to 8 recents, then available actions; no filters) · indexing (status line "Indexando… 120 de 480" between field and results; what is in memory shows at once) · no results (empty state of section 7, no buttons; partial matches say "Mostrando coincidencias parciales"). Enter opens the chosen result and closes. ⌘Enter closes and leaves a prepared question in the composer (query plus up to 3 hints), not sent. Search uses no AI and no tokens. The scope filters of the search spec ("Todos los alcances", "Carpetas de referencia") go; references always come in, marked "solo lectura".

## 9. Screen templates

Yellow parts are fixed in every template; violet parts are filled by the screen or the harness, only with what that zone allows. A harness may add its own templates, never move the fixed parts of these.

| # | Template | Shape |
|---|---|---|
| 1 | Work | Top bar · rail · task header · chat · composer · the two side columns, shown or hidden by the controls of section 10. |
| 2 | Work with split view (new) | Reader or context take the right 55 % next to the chat, replacing the right column while open. Cerrar closes it. |
| 3 | Secondary | Each rail button opens a page that replaces the work screen. Volver in the top bar. Title 20 + view (if any) + primary action; below, a list, or a list that opens the detail. Empty: icon 32 + sentence + action. |
| 4 | Inicio | No rail. One centered column, large button below. |
| 5 | Settings | Volver at the left of the top bar, nothing else on it. Nav on the left, sections in cards. Changes save themselves. |
| 6 | Assistant | Steps on the left. Exit on the left, advance on the right. |
| 7 | Dialog | To confirm or ask for a short value, never to navigate. |

Rules for all:

- **Rail:** each button leads to a page that replaces the current one. It never opens a panel or changes a column.
- **Top bar:** 40 px; title or crumbs start 90 px after the window buttons; ⚙ always in the right corner, except in Settings (Volver on the left and nothing else).
- **Primary action:** one per screen, card or dialog, last on the right of its bar. Secondary on its left; exit or danger apart, far left.
- **Cerrar** only in dialogs and the split view. Pages have Volver or the rail.

## 10. Work screen, zone by zone

Each zone has a closed list of contents, in order, and what shows or hides it.

**1 · Top bar (40).** Left: window buttons; crumbs Harness / Task (the first goes to Inicio). Right, outside in: ⚙ Settings (always) · search icon (new; quiet icon button, opens search; always except in Settings and the Assistant) · avatar (if profiles; popover) · bell with counter (if plugins have notices; popover) · Sidekick (new; compact quiet, no border or fill, grey on hover, with a status dot — green active · orange cards waiting · grey off — and text; opens and closes the right column; visible by default, work screen only) · grey tag "prueba" (test engine only). Nothing else: the Bandeja pill goes (its counter moves to the rail icon). Always visible; each right-side piece appears by its condition, never by a button.

**2 · Rail (64).** Entries in order: Inicio · Tareas · Bandeja (if parallel) · Jobs (if jobs) · Archivos (if notes, references or material) · Plugins (if plugin panels) · the harness's own pages. Each entry: 40 icon button, 18 icon, tooltip with the name, optional counter (Bandeja: waiting tasks). Selected = amber fill. Visible on Work and Secondary; absent on Inicio, Settings and the Assistant. Below 760 px it becomes a row on top.

**3 · Task header.** One row: task title (20) · on the right Historial (compact secondary with icon) and Nueva tarea (compact primary, only with parallel work). Row 2 goes: scope leaves the core, the context chip moves under the composer, plan usage moves to the right column footer and Settings › Uso, plugin chips go (reach them via rail › Plugins). Always one line (section 3, one-line bars); the title stays whole.

**4 · Task tabs.** One 40 tab per open task: name, orange dot if it waits for you, phase tag. Only with parallel work and more than one open task.

**5 · Phase and mode bar.** Phases: tags — done green with check, current orange, next ones as chips; on the right Terminar (compact secondary). Time: status line "quedan 12 min" + Pausar / Extender (compact quiet). Phase proposal: info notice with Ir (compact primary) and Ahora no. Mode: line "Modo: …" + Cambiar modo (quiet) that unfolds a list of options below. Each row appears if the task has phases, time or modes; no button hides it. Always one line: next phases merge into a "+N" chip; the buttons lose their border, then go into More (⋯) (they have no icon, so they skip the icon-only step).

**6 · Chat (reading column, 680).**

| Part | Allowed |
|---|---|
| Messages | Yours: bubble on the right, no label. Agent's: card with what it read on top ("+3 archivos leídos" chip) and the prose. Chat text 15. System: grey 13 line centered between two dividers (mode or phase change, time, another task touched your files). |
| Agent work | Grey line, no box: loading icon + "Trabajando…" + Ver detalle (link) → list of steps with check or loading icon. When done: foldable row "Revisó N cosas". |
| Tools | One grey 13 row per call: status icon (green check, loading, red attention) · name and datum · chevron on the right. Open shows data and result in a code block; a failed call starts open. Foldable group "Preparó N cosas". |
| Markdown | Headings (shown at 20 / 16 / 14, same in the reader), paragraph, lists, static checkboxes, table, code block with Copiar (compact quiet text button), Mermaid diagram with Ver fuente, quote, callout with its icon, link, image, footnote, material citation. |
| Documents | Chip with title and type; opens the Reader split view. |
| Blocks | Options (52 option with radio; recommended in amber; each with a type tag: Seguir orange, Profundizar blue, Preguntar violet) · mode recommendation · annotate text · form (inside a card: title, fields, Saltar · Enviar bottom right). Harness blocks: guide pieces (card, rows, options, buttons, tags) and, to draw, own CSS with tokens only (section 15). |
| Notices | Error: red box with title, text and Reintentar · Arreglar bottom right. Confirmation (before starting, level, time): orange notice with icon and its two compact buttons inside. Line "usó otro modelo". |
| No task | Task start: topics as tiles or list (segmented Tarjetas / Lista) + FAQ chips. |

**7 · Composer.** Above (optional): a task prepared by a plugin — card with title, text and Empezar (compact primary) / Cancelar. Card: textarea (Sidekick underline when it marks something); inside, bottom right: Revisar (quiet, if Sidekick) · Detener (secondary, while working) · Enviar (compact secondary with border; new — the work screen has no fixed primary, only those that appear on their own: Aprobar, Arreglar, Ir). Below, in 12 grey, outside the field: the context chip with ring (opens the Context split view), the caption ("Enter para enviar", "Revisando… ⌘ para enviar ya") and the harness caption. Inside the field only the typed text and the buttons. Always present in a task; in the Assistant interview it is replaced by a primary "Empezar entrevista".

**8 · Left column · Walkthrough (280).** Current question (with ring) · label "Recorrido · N/M" + nav items with step mark and tag (Visto / Ahora / Sigue). Nothing else: Notas, Referencias and Material go to the Archivos page; scope goes; plugin panels go to the Plugins page. Appears by itself when the harness works in walkthrough mode; no button. Hidden below 640 px and with the reader full screen.

**9 · Right column (280).** Header: only the open panel's title (15) + chevron icon button to fold; the panel-switching segmented goes — one panel only. Content is either the Sidekick or the harness panel. Harness panel: drawn with guide pieces only (section label, cards, rows, compact buttons, tags); takes the column only if the harness has no Sidekick or it is off, otherwise it goes to a rail page of its own. Folded (52): marks of the active sidekicks + orange dot if cards wait; one click opens it. Shown or hidden by the top-bar Sidekick button and the header chevron. Hidden while a split view is open and below 720 px.

**10 · Split view (55 %).** Reader — header: title 20, file crumbs, Texto icon (menu for size and width), Pantalla completa icon, Cerrar. Body: index (200, hidden below 1000 px) + 680 document at 16. Footer: compact review bar — Enviar comentarios (N) on the left · status, Ver cambios · Aprobar (primary) on the right. In review, a comments column (280) right of the document: one card per comment with avatar, type tag (Pregunta orange, Comentario blue, Resuelto grey) and a red "Bloquea" tag if it blocks approval (same tag in the chat; no ■); a question is answered with compact 40 options (exception, section 15). Context — header "Contexto" + Cerrar; labeled sections: what is loaded (rows with size), Agregar (menu), notes, what is no longer in. The Reader opens from a document chip, a document link or a file in Historial; Context from its chip under the composer. Cerrar or Escape closes; opening one closes the other.

### Sidekick column

Closed list: nothing else may appear, from a harness either. A harness only adds suggested sidekicks and places, which use these same cards.

| Part | Form |
|---|---|
| Header | "Sidekick" (15) and chevron to fold. Nothing else. |
| Status line | Marks (24 circle with a 14 set icon) of the sidekicks on in this task, in the person's order; on the right the state in 12: Mirando · Leyendo tu prompt… · Tiene una sugerencia · N avisos · Apagado. A mark with a waiting card has an orange dot. Clicking a mark opens a menu: Apagar en esta tarea · Ir a Settings. |
| Cards | Only the types below. The live card on top, with shadow; earlier ones fold to a 36 line (mark, what it was, grey result tag) — see open question 1. Only cards of the open task. |
| Footer | One 12 line with the Sidekick's spend in the task and the model level, plus the progress bar of that cap. Fixed at the bottom. |
| Folded (52) | Only the marks, stacked, with their orange dot. One click opens it. |

Card anatomy: radius 14, padding 12, text 13. Top to bottom, always this order, skipping absent parts: who speaks (24 mark + name 13) with the moment's tag on the right · title 13 semibold (optional) · text or short list · rewrite block (grey fill, additions in green) · "para después" rows · why (12, faint) with the link "No marcar esto" · actions on one line on the right, compact: dismiss (quiet) first, then secondaries, the amber primary last. At most one primary, only on the live card. No other icons: only the mark and the dot of the notice tag.

Card types (closed): Antes de enviar (orange; problems, rewrite, para después, why; Enviar igual · Editar · Enviar sugerido) · Después del turno (blue "Sigue"; what was missing and the next ask; Descartar · Al composer) · Lección (violet; Descartar · Al composer secondary) · Aviso (orange with dot; context almost full, repeated ask, off-phase, task waiting; only buttons calling paths that already exist: Guardar como decisión, Terminar tarea, Ir a la tarea) · Guardia (red "Antes de aprobar" or orange "Cambio de fase"; quotes the rule; Aprobar igual · Revisar) · Resumen del día (grey "Ayer"; up to 4 lines; only Descartar) · Respuesta de un lugar del harness (grey tag with the place's name; text only; only Descartar) · Presentación (first time, Sidekick off; what it does and what it costs; Ahora no · Prender) · Sugeridos por el harness (rows with mark, name, purpose and Adoptar; Ahora no at the bottom) · past card (36 line, a click unfolds it) · cap notice (one line, no buttons, once per task).

Column states: Mirando (empty state, no buttons) · Revisando (loading icon and countdown in text; the composer shows the same) · Apagado (grey marks; turned on from the top-bar Sidekick button or the presentation card).

## 11. Secondary pages

All use template 3: rail visible with the page's entry selected, title 20, on the right the view (if any) and one primary action. Volver at the left of the top bar on all of them (compact quiet with arrow), as in Settings; Escape also goes back. One Volver only: from a detail it goes to the list and says its name ("← Notas"); from the list it goes to the task ("← Informe"). Empty page: icon 32 + sentence + action, centered.

| Page | Opened from | Content |
|---|---|---|
| Bandeja | rail | List only: sections by state (tag + counter) with rows — title, chips, progress bar, level tag and quiet Cancelar. No board. |
| Jobs | rail | One card per job: toggle, frequency, daily cap (compact field) and runs as foldable rows. Correr ahora, secondary. Replaces the Jobs tab in Settings and the Jobs view of the Bandeja. |
| Archivos | rail (was drawer and column) | 40 tabs Notas · Referencias · Material (only those with content). Each is a list; picking a row opens its detail in the same column; Volver turns into "← Notas" and goes back to the list. Notas: learned or yours, Editar / Borrar. Referencias: read only, with lock. Material: sources with Agregar (primary). |
| Historial | task header (was drawer) | Days with foldable rows per task; inside, files (open the Reader or the timeline) and "Volver a este punto" with the undo icon. A file's timeline is a detail of this page; Volver goes back to the day. |
| Plugins | rail (was panel) | Plugin list on the left, like Settings (with notice dot); on the right, the chosen plugin's panel (iframe) built only with the plugin kit: table, compact buttons, chips, stat. Each plugin's configuration stays in Settings › Plugins. |

## 12. Inicio, Assistant and Settings

| Screen | Zone | Allowed content, in order |
|---|---|---|
| Inicio | Top bar | Avatar · search · ⚙. |
| | Centered column | Logo 84 · name 28 · sentence 15 · card of missing steps (step marks) or a problem notice · language notice (Más tarde / Elegir) · large Empezar button (with arrow) or Configurar · engine chip (logo, name, dot, usage) · Retomar (12 uppercase grey label + task cards; the section is absent when empty) · backup notice. Section titles on Inicio are 12 uppercase grey labels. |
| | Footer | Brand and folder. |
| Assistant | Left (280) | Nav items with step mark, name and chosen value (12). Current step: white fill with shadow and "Paso n de m". |
| | Body | Title 20 + sentence · the step: form, engine as 52 options, place options, connection rows or interview · engine install boxes: card with numbered steps, code block and secondary buttons · foldable details with the log · status line. |
| | Action bar | Cancelar (left) · Atrás (secondary) · Saltar (quiet, next to Siguiente) · Siguiente. Below, caption "podés cambiarlo después". End: large step mark, summary rows, large Empezar button (with arrow, as on Inicio). |
| | Top | Notice "Configurando…" with Cancelar while a step runs. |
| Settings | Top bar | Volver on the left (compact quiet with arrow and the name of where you came from). Nothing else: changes save themselves. |
| | Left (280) | Title 20 · nav items (General, Motor, Modelos, Uso, Conexiones, Sidekick, Plugins, the harness's own) with optional counter. |
| | Body | Section header without title (the selected item says it): 13 grey sentence and, if needed, a control on the right · cards with title 15 and settings rows; right of a card title only a tag; a control (the Sidekick toggle, the engine in Niveles) drops to the card's first row · engine as 52 options (no tiles), with "Usar este motor" inside its card, bottom right · text size as segmented · lists (profiles, plugins, usage) loose: group title 13 grey + bordered rows, no card · small actions in a row (Editar, Reactivar, Restaurar todo) as quiet buttons · save error: red notice above the card · stats (card with label 12 and value 20) · table (usage) · list and detail (plugins: row with name, state tag, toggle; the detail uses the top-bar Volver, which turns into "← Plugins") · editor inside a card (sidekick, custom model) · inline confirmation to delete · empty state. |

## 13. Migration list

All 83 rows were approved on 2026-11-02. They are the work of adapting the code. Type: Adapt = changes to fit the guide · Add = enters the guide as a new piece · Remove = disappears.

| # | Today | Becomes | Type |
|---|---|---|---|
| 1 | Notas on the rail opens a drawer over the chat | Archivos page (Notas · Referencias · Material, list and detail) | Adapt |
| 2 | Plugins on the rail opens a panel in the left column | Plugins page with the plugin list on the left, like Settings; the task's left column stops showing plugins | Adapt |
| 3 | Historial opens a drawer | Historial page with Volver in the top bar; a file's timeline becomes a detail of that page | Adapt |
| 4 | Reader and Context dock at 55 % (exists, unnamed) | Template "Work with split view" with Cerrar | Add |
| 5 | Sidekick column (320/330) + 52 strip + separate harness panel (280) | One right column of 280 with one panel and its title, folded to 52. With Sidekick on, the harness panel goes to a rail page | Adapt |
| 6 | Bandeja pill in the top bar (repeats the rail) | Counter on the rail's Bandeja icon | Remove |
| 7 | Jobs: tab in Settings and view in the Bandeja | All in the Jobs page | Adapt |
| 8 | Task title at 28 | 20, so the chat gains height | Adapt |
| 9 | `.hh-pill` (Historial, Sidekick, context, engine, Restaurar) | Compact secondary or chip | Adapt |
| 10 | Toggles in three forms | One toggle; several from a list = toggles, one per row; checkbox only to accept | Adapt |
| 11 | 11 px text in ~30 places; titles of 17 and 18 | 12 minimum; 20 for titles | Adapt |
| 12 | Characters as icons: ✓ ← × ✕ › ↩ | Set icons (check, back, close, chevron) or text | Adapt |
| 13 | Two chevrons (12 and 14) and 6 stroke widths | One, stroke 1.75 | Adapt |
| 14 | Loading indicator as a GIF | Loading icon of the set | Adapt |
| 15 | Markdown callout icons | Enter the set, for that use only | Add |
| 16 | ~10 error and notice styles, unstyled `role=alert` | Status line / notice / confirmation | Adapt |
| 17 | Floating search notice (4 s) | Notice under the top bar, does not vanish on its own | Adapt |
| 18 | Loose badges: `.hh-badge` (defined twice), "Actualizado", "Lista", "Pendiente" | Tag | Adapt |
| 19 | Three step marks (18, 26, 26 square) and a 48 circle at the end | 24 mark; at the end, empty state with check 32 | Adapt |
| 20 | 52 Empezar button on Inicio | Large button, only Inicio and end of the Assistant | Add |
| 21 | 104 tiles (engine, topics) | Tile only for topics; engine becomes 52 options | Add |
| 22 | Segmented 28 / radius 6 | 30 / 8 | Adapt |
| 23 | Tabs of 44 (tasks) and 24 (plugins) | Tab of 40 | Adapt |
| 24 | Number, password, time, textarea and checkboxes with browser style | Same measures as the field | Adapt |
| 25 | Plugin kit (button 24 / radius 6, chip 22) and demo (buttons 24, label 11) | Compact guide pieces. The only thing a plugin panel may use | Adapt |
| 26 | The demo diagram's own arrows | Stay as the block's drawing, not as an icon | Add |
| 27 | Connection letter (32, square) | Avatar of 32 | Adapt |
| 28 | Scope: select, Settings window (radius 14, height 100 % − 76) and Agregar… | Leaves the core | Remove |
| 29 | Custom tooltip on annotation marks | The only custom tooltip allowed | Add |
| 30 | "mock" badge (bordered pill) | Grey tag "prueba" | Adapt |
| 31 | Rail of 76 | 64 | Adapt |
| 32 | Duplicate CSS rules overriding each other (side column, Sidekick, Sidekick card, dot) | One rule per piece (no visible change) | Adapt |
| 33 | Enviar is the amber primary, outside the field | Compact secondary (bordered) inside the field, bottom right. No fixed primary on the work screen | Adapt |
| 34 | Sidekick pill in the task header | Sidekick button with status dot in the top bar, visible by default on the work screen | Adapt |
| 35 | Task header in two rows (scope, context, plan usage, plugin chips) | One row: title + Historial + Nueva tarea | Adapt |
| 36 | Search opens only with ⌘K | Search icon (quiet icon button) in the top bar next to ⚙, on every screen except Settings and the Assistant | Add |
| 37 | Left column with Notas, Referencias and Material | The column shows only the walkthrough; the rest goes to the Archivos page, which replaces the Notas entry | Adapt |
| 38 | Task header and phase bar wrap to two lines when narrow | Always one line, buttons never stacked: normal → borderless → icon only → More (⋯); the title is not cut | Add |
| 39 | Search (spec 2026-10-30) has no footer | One-line shortcut footer so ⌘Enter is discoverable | Add |
| 40 | Search spec filters "Todos los alcances" and "Carpetas de referencia" | No scope filter; references always in, marked "solo lectura" | Remove |
| 41 | Before-send card with Usar / Ajustar / Ignorar and mixed weights | Enviar igual (quiet) · Editar · Enviar sugerido (primary); same anatomy for all cards | Adapt |
| 42 | Header with mark, name and state of the last sidekick that spoke | Header only "Sidekick"; marks and state in a status line below; each card says who speaks | Adapt |
| 43 | Sidekick footer with plan usage | Footer with the Sidekick's spend in the task. Plan usage back to Settings › Uso | Adapt |
| 44 | A sidekick mark is an emoji or a color | A set icon in a 24 circle: one per purpose; a custom one picks from the set. Harness presets too | Adapt |
| 45 | 22 single-use colors: callouts (6), review (4), diffs (4), avatars (8), plus `--hh-highlight` | Gone. They use the 5 tag colors plus grey; avatars stay at 6 | Adapt |
| 46 | DM Sans 700 loaded; 500 without a fixed use | Weights 400, 500 (buttons and chips) and 600. 700 goes | Adapt |
| 47 | Inline code undefined; system monospace | DM Mono, grey fill, radius 4, one point smaller | Add |
| 48 | Not said which colors a harness may change | Any token, light and dark; never a new one or a loose color | Add |
| 49 | Cards with padding 12, 14, 16 or 24 and radius 12 or 14; controls top right; nested cards (Settings › Modelos) | One card: radius 14, padding 16 or 24, only a tag right of the title, up to 2 compact buttons bottom right, never nested | Adapt |
| 50 | Forms without anatomy | Label on top, asterisk on required, error under the field, radios only in 52 options | Adapt |
| 51 | A harness may declare any field (includes a "slider") | Only the 12 closed types | Adapt |
| 52 | Read-only data as loose "label : value" rows | Settings row without control, value as grey tag | Adapt |
| 53 | Connection with Guardar, Reemplazar, unconfirmed Borrar and inline Probar | One button + More (⋯) with Borrar and Probar | Adapt |
| 54 | Tags use undefined 500 | Tags at 600 | Adapt |
| 55 | Modelos marks a changed value with Restaurar | No Restaurar: "Recomendado: …" in 12 grey, only if different | Adapt |
| 56 | Loose checkboxes to mark several from a list | Toggles, one per row | Adapt |
| 57 | Markdown compared rendered, with a side bar | Always as lines, like code | Remove |
| 58 | Two changed-word styles (diff viewer and yellow Sidekick) | One: green fill and red fill struck through | Adapt |
| 59 | Review marks with background only | Background + 2 px underline in the type's ink | Adapt |
| 60 | Orange "Bloquea" in the column and another chip in the chat; spec asked for ■ | One red "Bloquea" tag in both places; no ■ | Adapt |
| 61 | Comment cards do not say their type | Type tag in the header | Add |
| 62 | Review questions with loose radios | Compact 40 option (exception, 280 column only) | Add |
| 63 | Review bar with 40 buttons and no primary | Compact: Enviar left, Aprobar (primary) right | Adapt |
| 64 | Margin dots all amber | Type color | Adapt |
| 65 | Your message labeled "You" | Bubble without label | Remove |
| 66 | Agent reply as loose text | Card with what it read on top | Adapt |
| 67 | Chat options fill black when chosen; no type | 52 option with radio and type tag | Adapt |
| 68 | Chat form without a box, Saltar as link | Card with Saltar · Enviar bottom right | Adapt |
| 69 | Tool call as grey text without icon | Row with status icon and chevron on the right | Adapt |
| 70 | "Trabajando…" in a grey box with GIF | Line without box, set loading icon | Adapt |
| 71 | Centered system notices | Line with dividers on both sides | Adapt |
| 72 | Confirmations in a box with 40 buttons on the left | Orange notice with two compact buttons inside | Adapt |
| 73 | Markdown headings unsized in chat (1.6 / 1.3 / 1.1 em in the reader) | 20 / 16 / 14 in both | Adapt |
| 74 | Settings exits with a floppy icon | Volver at the left of the top bar | Adapt |
| 75 | Settings tab header with title 28 | No title; only the grey sentence and the control | Remove |
| 76 | Engine as tiles with ✓; three "chosen" styles | 52 options in Settings and the Assistant | Adapt |
| 77 | Text size as "Aa" tiles | Segmented | Adapt |
| 78 | "Usar motor" loose above the card | Inside the card, bottom right | Adapt |
| 79 | Five error styles in Settings | Field: red under the field. Page or group: red notice above the card | Adapt |
| 80 | Small actions as link, pill or button | Quiet button | Adapt |
| 81 | Inicio: name 40 and section titles 15 | Name 28; sections with 12 uppercase grey label | Adapt |
| 82 | Assistant Saltar secondary, like Atrás | Quiet, next to Siguiente | Adapt |
| 83 | Assistant end Empezar without arrow | With arrow, as on Inicio | Adapt |

## 14. Out of scope

- Specific harnesses (Socrates, Ariadna and others) — they adopt the guide in their own repos.
- The scope feature (row 28) beyond removing its UI from the core.
- New screens not listed here. They enter through section 15.

## 15. How the guide grows

| Topic | Rule |
|---|---|
| New piece | 1. A proposal with the options drawn on a decision page. 2. Marco picks. 3. One PR adds the piece to the code and its row to the guide. Nothing enters another way. |
| Exceptions | Allowed, each with its own row: where it applies and why. Today: compact 40 option (comments column of 280 only) · custom tooltip (annotation marks only) · markdown callout icons (only there) · large button (Inicio and end of the Assistant only). |
| Harness chat blocks | Guide pieces and, when a drawing is needed (a diagram, a map), own CSS that uses only tokens: the guide's colors, measures and radii. No loose color or size. |
| Plugin panels | Only the plugin kit, which copies the compact guide pieces (table, compact button, chip, stat) with the app's tokens. Nothing else inside the iframe. |
| Control | Both: an automated test that fails on a loose color, a size off the scale or a class not in the guide; and a guide checklist in the description of every PR that touches UI. |
| Where it lives | Both: a dev-mode page inside the app (Settings › Guía de estilo) showing the real pieces built from the code, and `docs/style-guide.md` with the rules. The artifact is the draft until they exist. |

## 16. Implementation approach

The work is large; the plan should split it into stages that each leave the app working. Suggested order:

1. **Tokens and scale.** Rewrite the token block of `packages/ui/src/styles.css` to the tables of section 2 (light and dark). Add `--hh-column-w` and `--hh-split-w`; set `--hh-rail-w` to 64. Map and remove `--hh-callout-*`, `--hh-review-*`, `--hh-diff-*`, `--hh-profile-*`, `--hh-highlight` and every other color token not in the guide. Replace loose sizes, radii, spacings and weights (11 px text, 700, radius 6/24/999 outside round pieces) with the scale. Mirror the same tokens in `packages/ui/src/plugin-ui/tokens.css`.
2. **Guard test.** Extend `packages/ui/test/styles.test.ts` (or a sibling) so it fails on: a hex/rgb color outside the token definitions; a `px` height, radius, gap, padding or font size off the scale; a weight other than 400/500/600; a `className` in `packages/ui/src` that is not in an allow-list of guide classes. Harness CSS files are checked for token-only colors and sizes. Land it early with an explicit list of known offenders that shrinks with each stage, so it never blocks a merge but never grows.
3. **Pieces.** One component per guide piece in `packages/ui` (Button with type and size, IconButton, Segmented, Tabs, NavItem, Option, Tile, Toggle, Checkbox, Field and the 12 field types, SettingsRow, Tag, Chip, Counter, Dot, StepMark, ProgressBar, Avatar, Card, StatusLine, Notice, InlineConfirm, EmptyState, Dialog, Popover, Menu) and one icon set (24 box, 1.75 stroke) with the closed names of section 4. Old classes map per the table in section 3.
4. **Templates and zones.** Top bar, rail and the seven templates; then the work-screen zones (header in one row with one-line compression, Sidekick right column, split view, composer), the secondary pages (Archivos, Historial, Plugins, Jobs, Bandeja), Inicio, the Assistant and Settings — following the migration list.
5. **Plugin kit.** Rebuild `plugin-ui/components.tsx` and `plugin-ui.css` on the compact pieces and the shared tokens.
6. **Guide page and doc.** A dev-mode page Settings › Guía de estilo that renders every piece from the real components, in light and dark, and `docs/style-guide.md` with the rules of this spec. Add the UI checklist to the PR template.

Each stage runs the existing UI and e2e tests; visual changes are checked in the running app (light and dark) before merging.

## 17. Open questions

Found while writing this spec; Marco decides.

1. **Heights outside the closed list.** The heights table allows 18, 24, 30, 40, 52 and 104, but the guide also uses a 56 search field and a 36 line for past Sidekick cards.
2. **Search icon in the Assistant.** Row 36 and zone 1 say no search icon in the Assistant, but the Assistant template mock shows 🔍 ⚙.
3. **`.hh-pl-tab`.** Today it switches between the panels of a plugin; the mapping table sends it to Tabs (40). With the Plugins page now a list on the left, it is not said what happens when one plugin has several panels.
