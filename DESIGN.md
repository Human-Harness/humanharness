---
name: Human Harness
description: "The closed-world design rules of the Human Harness app: Radix Themes pieces, our tokens, and the screens they make."
colors:
  hh-bg: "#f3f3f1"
  hh-bg-dark: "#121315"
  hh-rail: "#fbfbfa"
  hh-rail-dark: "#16171a"
  hh-column: "#f8f8f6"
  hh-column-dark: "#17181b"
  hh-surface: "#ffffff"
  hh-surface-dark: "#1e2024"
  hh-surface-2: "#f2f2ef"
  hh-surface-2-dark: "#26292e"
  hh-line: "#e7e7e3"
  hh-line-dark: "#2a2d32"
  hh-line-strong: "#d9d9d4"
  hh-line-strong-dark: "#383c42"
  hh-ink: "#1b1c1e"
  hh-ink-dark: "#eceef0"
  hh-muted: "#62656b"
  hh-muted-dark: "#a3a8ae"
  hh-faint: "#8a8d93"
  hh-faint-dark: "#80858c"
  hh-cta: "#fbd38d"
  hh-cta-dark: "#f3c56a"
  hh-cta-ink: "#3b2a06"
  hh-cta-ink-dark: "#2a1d02"
  hh-cta-hover: "#f8c76e"
  hh-cta-hover-dark: "#f7d184"
  hh-active: "#fde6b3"
  hh-active-dark: "#3a2e14"
  hh-active-ink: "#7a4f00"
  hh-active-ink-dark: "#f3c56a"
  hh-t-green: "#dff2e5"
  hh-t-green-dark: "#17311f"
  hh-t-green-ink: "#1d6e3f"
  hh-t-green-ink-dark: "#8bd8a8"
  hh-t-orange: "#fdebd7"
  hh-t-orange-dark: "#3a2715"
  hh-t-orange-ink: "#a94f08"
  hh-t-orange-ink-dark: "#f4b47e"
  hh-t-blue: "#e4ecfd"
  hh-t-blue-dark: "#1c2944"
  hh-t-blue-ink: "#2d55c4"
  hh-t-blue-ink-dark: "#a3beff"
  hh-t-violet: "#ece6fb"
  hh-t-violet-dark: "#29223f"
  hh-t-violet-ink: "#5f3dba"
  hh-t-violet-ink-dark: "#c6b4ff"
  hh-t-red: "#fbe4e1"
  hh-t-red-dark: "#3b1d19"
  hh-t-red-ink: "#a3321f"
  hh-t-red-ink-dark: "#f3a497"
  hh-backdrop: "rgba(27, 28, 30, 0.18)"
  hh-backdrop-dark: "rgba(0, 0, 0, 0.45)"
typography:
  hh-font:
    fontFamily: '"DM Sans", -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
    fontSize: "14px"
  hh-display:
    fontFamily: '"DM Sans", -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
  hh-mono:
    fontFamily: '"DM Mono", ui-monospace, monospace'
rounded:
  hh-r-compact: "8px"
  hh-r-control: "12px"
  hh-r-card: "14px"
  hh-r-dialog: "18px"
spacing:
  hh-s-1: "4px"
  hh-s-2: "8px"
  hh-s-3: "12px"
  hh-s-4: "16px"
  hh-s-5: "24px"
  hh-s-6: "32px"
---

# Design System: Human Harness

## Overview

**Creative North Star: "The Closed World"**

Radix Themes provides the pieces: accent amber, gray sand, radius large, sizes 1 to 4. Impeccable provides the loop. This file holds our rules. A screen uses only the pieces listed here (spec §1, §2 "Closed world").

Screens import the pieces from one barrel, `packages/ui/src/guide`, as the `Rx` namespace. The barrel lists 27 names: AlertDialog, Avatar, Badge, Box, Button, Callout, Card, Checkbox, Code, Dialog, DropdownMenu, Flex, Grid, Heading, IconButton, Popover, Progress, RadioGroup, ScrollArea, SegmentedControl, Select, Separator, Switch, Tabs, Text, TextArea, TextField (`packages/ui/src/guide/radix.ts`). A guard test keeps the list closed. Our wrappers (`Field`, `Group`, `Row`, `SettingsNav`) are named below but are not in the barrel yet: they arrive with the screens that need them, from stage 2 on (spec §7).

The tokens above come from `packages/ui/src/styles.css`. Every key ending in `-dark` is the dark value of the key without it. The app follows the system's light or dark mode (spec §3).

A harness may change token values, light and dark. It may not add tokens, use a loose color, or move the fixed parts of the core templates (guide §1).

**Key Characteristics:**
- Every color is a token. Every piece is on the list.
- Each zone of a screen has a closed list of contents (guide §1, §10).
- Pieces come from Radix. Composition rules come from this file.

In this file, "spec" is `docs/superpowers/specs/2026-11-04-radix-impeccable-design.md` and "guide" is `docs/superpowers/specs/2026-11-02-style-guide-design.md`.

## Colors

Warm gray surfaces, one amber accent, and five tag colors that always mean the same thing. Every color in the app is one of the tokens in the frontmatter (guide §2).

### Primary
- **Amber button** (`hh-cta`, `hh-cta-ink`, `hh-cta-hover`): the primary button, its text and its hover (guide §2).
- **Chosen amber** (`hh-active`, `hh-active-ink`): the chosen thing: item, chip, segment, search match, active review mark. Also text on it (guide §2).

### Neutral
- **Window** (`hh-bg`): window background (guide §2).
- **Rail** (`hh-rail`): the rail (guide §2).
- **Column** (`hh-column`): side columns (guide §2).
- **Surface** (`hh-surface`): cards, dialogs, fields, buttons (guide §2).
- **Surface 2** (`hh-surface-2`): grey fill for hover, segmented, code and the grey tag (guide §2).
- **Line** (`hh-line`): borders and separators (guide §2).
- **Line strong** (`hh-line-strong`): hover border, dim dot (guide §2).
- **Ink** (`hh-ink`): text and icons (guide §2).
- **Muted** (`hh-muted`): secondary text, idle icons (guide §2).
- **Faint** (`hh-faint`): placeholder, dim mark (guide §2).
- **Backdrop** (`hh-backdrop`): the dimmed background behind a dialog (guide §2).

### Tag colors
Green, orange, blue, violet and red each have a background and an ink (`hh-t-*`, `hh-t-*-ink`). Grey is `hh-surface-2` with `hh-ink` in both themes (guide §2).

- Green: done, active, in use. Orange: your turn, about to run out, next. Blue: in progress, kind of learned thing. Violet: model level (light green, standard blue, deep violet). Red: error. Grey: pending, off, test mode (guide §6).

Special uses take only the tag colors (guide §2):
- Markdown callouts (Note, Tip, Warning, Summary, Decision, Question).
- Diffs: added lines green, removed lines red. Words inside a line: green background, or red background struck through. The Sidekick uses the same.
- Review marks: background plus a 2 px underline in the type's ink. Question orange, comment blue, resolved grey. The active one uses `hh-active`.
- Profile avatars: six colors (green, orange, blue, violet, red, grey) with their tag ink.

### Named Rules
**The Token Rule.** Every color is a token. No hex or rgb value appears outside the token definitions (guide §2, §15).

Open: Radix draws its own colors from accent amber and gray sand. The bridge in `styles.css` maps only fonts and the background to our tokens. Which tokens should a Radix piece's fill, border and text use? The guide's color table does not answer this for Radix pieces.

## Typography

**Display Font:** DM Sans (with system fallbacks)
**Body Font:** DM Sans
**Label/Mono Font:** DM Mono, for code and keys only

**Character:** One family for everything. Mono only where text is code (guide §2).

### Hierarchy
- **App name** (600, 28): only the app name on Inicio (guide §2).
- **Panel title** (600, 20): task title, secondary pages, dialogs, assistant steps, Settings nav (guide §2).
- **Reading text** (400, 16): only the reader document (guide §2).
- **Card title** (600, 15) and **chat reply** (400, 15) (guide §2).
- **Body** (400, 14) (guide §2).
- **Secondary text** (400, 13). Compact button (500, 13) (guide §2).
- **Section label and caption** (12): the minimum size (guide §2).
- **Inline code** (DM Mono 400, one point below the sentence, `hh-surface-2` background, radius 4): commands, paths and file names inside a sentence (guide §2).

### Named Rules
**The Three Weights Rule.** Weights are 400 for text, 500 for button and chip text, 600 for titles, labels and tags. No 700 (guide §2).

Open: Radix has its own text scale (`Text` and `Heading` sizes). Which Radix size matches each role above? The guide gives px sizes, and the Radix scale is not mapped to them.

## Layout

Spacing is 4, 8, 12, 16, 24 and 32. Nothing else (guide §2). The tokens are `hh-s-1` to `hh-s-6`.

Piece sizes follow Radix's scale 1 to 4. The guide's closed heights are dropped (spec §9.5).

Widths come from `styles.css` and are closed (guide §2):
- Rail: 64 (`--hh-rail-w`).
- Side columns: 280, min 220, max 320 (`--hh-column-w`).
- Split view: 55 % (`--hh-split-w`).
- Reading column: 680 (`--hh-read-w`).
- Dialog: 440, search 640 (`--hh-dialog-w`, `--hh-dialog-w-search`).
- Popover: 320 (`--hh-popover-w`).
- Reader index: 200 (`--hh-index-w`).

Open: Radix has its own space scale (`gap`, `p`, `m` props). Does it map to the six spacing steps above?

### Screen templates (guide §9)

Fixed parts are the same in every template. A harness fills the rest, only with what the zone allows. A harness may add templates of its own. It may not move the fixed parts of these.

| # | Template | Shape |
|---|---|---|
| 1 | Work | Top bar, rail, task header, chat, composer, the two side columns shown or hidden by the controls of the zones below. |
| 2 | Work with split view | Reader or context take the right 55 % next to the chat and replace the right column while open. Cerrar closes it. |
| 3 | Secondary | Each rail button opens a page that replaces the work screen. Volver in the top bar. Title 20, the view (if any) and a primary action. Below: a list, or a list that opens the detail. |
| 4 | Inicio | No rail. One centered column, large button below. |
| 5 | Settings | Volver at the left of the top bar, nothing else on it. Nav on the left, sections in cards. Changes save themselves. |
| 6 | Assistant | Steps on the left. Exit on the left, advance on the right. |
| 7 | Dialog | To confirm or ask for a short value. Never to navigate. |

Rules for all templates (guide §9):
- **Rail:** each button leads to a page that replaces the current one. It never opens a panel or changes a column.
- **Top bar:** 40 px. Title or crumbs start 90 px after the window buttons. The Settings icon is always in the right corner, except in Settings.
- **Primary action:** one per screen, card or dialog, last on the right of its bar. Secondary on its left. Exit or danger apart, far left.
- **Cerrar** only in dialogs and the split view. Pages have Volver or the rail.

### Work screen, zone by zone (guide §10)

Each zone has a closed list of contents, in order. What is not on the list does not go there.

1. **Top bar.** Left: window buttons, crumbs Harness / Task (the first goes to Inicio). Right, outside in: Settings (always), search icon (quiet icon button; not in Settings or the Assistant), avatar (if profiles; popover), bell with counter (if plugins have notices; popover), Sidekick (compact quiet button with a status dot and text; work screen only), grey tag "prueba" (test engine only). Nothing else. Each right-side piece appears by its condition, never by a button.
2. **Rail.** In order: Inicio, Tareas, Bandeja (if parallel), Jobs (if jobs), Archivos (if notes, references or material), Plugins (if plugin panels), the harness's own pages. Each entry is an icon button with a tooltip and an optional counter. Selected is the amber fill. Visible on Work and Secondary. Absent on Inicio, Settings and the Assistant. Below 760 px it becomes a row on top.
3. **Task header.** One row: task title, and on the right Historial (compact secondary with icon) and Nueva tarea (compact primary, only with parallel work). The title stays whole.
4. **Task tabs.** One tab per open task: name, orange dot if it waits for you, phase tag. Only with parallel work and more than one open task.
5. **Phase and mode bar.** Phases as tags: done green with check, current orange, next ones as chips. On the right Terminar (compact secondary). Time: status line "quedan 12 min" with Pausar and Extender (compact quiet). Phase proposal: info notice with Ir (compact primary) and Ahora no. Mode: line "Modo: ..." with Cambiar modo (quiet). Each row appears if the task has phases, time or modes.
6. **Chat (reading column).** Messages: yours as a bubble on the right with no label. The agent's as a card with what it read on top and the prose. System: a grey 13 line centered between two dividers. Agent work: a grey line with the loading icon and "Trabajando...", then a foldable row "Revisó N cosas". Tools: one grey 13 row per call with status icon, name and a chevron. Open shows data and result in a code block. A failed call starts open. Markdown: headings, paragraph, lists, static checkboxes, table, code block with Copiar, Mermaid diagram with Ver fuente, quote, callout, link, image, footnote, material citation. Documents: a chip that opens the Reader split view. Blocks: mode recommendation, annotate text, and a form inside a card (Saltar secondary, Enviar primary, bottom right). Notices: error with Reintentar and Arreglar bottom right. Confirmation before starting, level or time as an orange notice with two compact buttons.
7. **Composer.** Above, optional: a task prepared by a plugin, as a card with Empezar (compact primary) and Cancelar. The card holds the textarea. Inside, bottom right: Revisar (quiet, if Sidekick), Detener (secondary, while working), Enviar (compact secondary with border). The work screen has no fixed primary. Below, in 12 grey and outside the field: the context chip with ring, the caption, the harness caption. Inside the field only the typed text and the buttons.
8. **Left column, Walkthrough.** The current question, the label "Recorrido · N/M" and nav items with a tag (Visto, Ahora, Sigue). Nothing else. It appears by itself when the harness works in walkthrough mode. Hidden below 640 px and with the reader full screen.
9. **Right column.** Header: only the open panel's title and a chevron icon button to fold. Content is either the Sidekick or the harness panel. A harness panel is drawn with listed pieces only. It takes the column only if the harness has no Sidekick or it is off. Otherwise it gets a rail page. Folded, it shows the marks of the active sidekicks and an orange dot if cards wait. Hidden while a split view is open and below 720 px.
10. **Split view.** Reader: header with title, file crumbs, Texto icon, Pantalla completa icon and Cerrar. Body: index and the 680 document. Footer: review bar with Enviar comentarios (N) on the left and status, Ver cambios, Aprobar (primary) on the right. In review, a comments column of 280 with one card per comment: avatar, type tag (Pregunta orange, Comentario blue, Resuelto grey) and a red "Bloquea" tag if it blocks approval. Context: header "Contexto" and Cerrar. Sections: what is loaded, Agregar (menu), notes, what is no longer in. Cerrar or Escape closes. Opening one closes the other.

One-line bars (guide §3). The task header and the phase and mode bar never wrap to two lines. When width runs out, buttons compress right to left, in this order:
1. As they are.
2. No border or fill: all become quiet, with icon and text.
3. No text: quiet icon buttons with a tooltip, only for those with an icon and text pair.
4. One More button (⋯) that opens a menu with every action as text, same order.

Buttons without an icon jump from step 2 to step 4. The title is never cut to make room. Buttons never stack or wrap.

### Sidekick column (guide §10)

A closed list. Nothing else may appear, from a harness either. A harness only adds suggested sidekicks and places, which use these same cards.

- **Header:** "Sidekick" and a chevron to fold. Nothing else.
- **Status line:** the marks of the sidekicks on in this task, and on the right the state: Mirando, Leyendo tu prompt..., Tiene una sugerencia, N avisos, Apagado. A mark with a waiting card has an orange dot.
- **Cards:** only the types below. The live card on top with shadow. Earlier ones fold to one line with a grey result tag. Only cards of the open task.
- **Footer:** one 12 line with the Sidekick's spend in the task and the model level, plus a progress bar for that cap. Fixed at the bottom.
- **Card anatomy**, always in this order, skipping absent parts: who speaks with the moment's tag on the right, title (optional), text or short list, rewrite block, "para después" rows, why with the link "No marcar esto", actions on one line on the right (dismiss quiet first, then secondaries, the amber primary last). At most one primary, only on the live card. No other icons: only the mark and the dot of the notice tag.
- **Card types (closed):** Antes de enviar (orange), Después del turno (blue "Sigue"), Lección (violet), Aviso (orange with dot), Guardia (red "Antes de aprobar" or orange "Cambio de fase"), Resumen del día (grey "Ayer"), Respuesta de un lugar del harness (grey), Presentación, Sugeridos por el harness, past card, cap notice.

### Secondary pages (guide §11)

All use template 3. The rail is visible with the page's entry selected. Volver is at the left of the top bar on all of them (compact quiet with arrow). Escape also goes back. One Volver only: from a detail it goes to the list and says its name ("← Notas"). From the list it goes to the task.

- **Bandeja:** a list only, in sections by state (tag and counter). Rows: title, chips, progress bar, level tag and quiet Cancelar. No board.
- **Jobs:** one card per job: toggle, frequency, daily cap and runs as foldable rows. Correr ahora, secondary.
- **Archivos:** tabs Notas, Referencias, Material (only those with content). Each is a list. Picking a row opens its detail in the same column. Notas: Editar and Borrar. Referencias: read only, with lock. Material: sources with Agregar (primary).
- **Historial:** days with foldable rows per task. Inside: files (open the Reader or the timeline) and "Volver a este punto" with the undo icon.
- **Plugins:** the plugin list on the left, like Settings. On the right, the chosen plugin's panel (iframe). A plugin with several panels shows tabs above its panel. Each plugin's configuration stays in Settings › Plugins.

### Inicio, Assistant and Settings (guide §12)

- **Inicio.** Top bar: avatar, search, Settings. A centered column, in order: logo, name, sentence, card of missing steps or a problem notice, language notice (Más tarde, Elegir), large Empezar button or Configurar, engine chip (logo, name, dot, usage), Retomar (12 uppercase grey label and task cards; absent when empty), backup notice. Section titles on Inicio are 12 uppercase grey labels. Footer: brand and folder.
- **Assistant.** Left: nav items with name and chosen value (12). The current step is a white fill with shadow and "Paso n de m". Body: title and sentence, then the step (form, connection rows or interview), engine install boxes (a card with numbered steps, a code block and secondary buttons), foldable details with the log, a status line. Action bar: Cancelar (left), Atrás (secondary), Saltar (quiet, next to Siguiente), Siguiente. Below, the caption "podés cambiarlo después". The end has summary rows and a large Empezar button with arrow, as on Inicio. Top: a notice "Configurando..." with Cancelar while a step runs.
- **Settings.** Top bar: Volver on the left (compact quiet with arrow and the name of where you came from), nothing else. Left: title and nav items (General, Motor, Modelos, Uso, Conexiones, Sidekick, Plugins, the harness's own) with an optional counter. Body: a section header without a title, with a 13 grey sentence and, if needed, a control on the right. Cards with a 15 title and settings rows. Right of a card title only a tag. A control (the Sidekick toggle, the engine in Niveles) drops to the card's first row. Text size as segmented. Lists (profiles, plugins, usage) loose: a 13 grey group title and bordered rows, no card. Small actions in a row (Editar, Reactivar, Restaurar todo) as quiet buttons. A save error is a red notice above the card. Stats: a card with a 12 label and a 20 value. Table for usage. Plugins as list and detail: row with name, state tag and toggle; the detail uses the top-bar Volver, which turns into "← Plugins". An editor goes inside a card.

### Settings rows (spec §2)

- **Row anatomy:** name and hint on the left. The control right-aligned in one column. A hairline between rows.
- **Grouping:** rows are grouped in cards. No nested cards. Tight spacing inside a group, generous between groups.
- **Read-only data:** the same row with no control. The value is a grey tag on the right (guide §5).
- **Recommended value:** if the chosen value is not the recommended one, "Recomendado: ..." in 12 grey goes under the control. Nothing when it matches (guide §5).
- **Field error:** a red status line under the label (guide §5).
- **One highlighted band per page at most**, for the one thing that needs the person (spec §2).
- **Narrow panels:** a plugin panel works at 240 px with no horizontal scroll (spec §6).

## Elevation & Depth

Surfaces are flat at rest and separated by a border. Depth comes from two tokens only: a shadow for cards and layers, and a backdrop behind dialogs (guide §2). Nothing else.

### Shadow Vocabulary
- **Layer shadow** (`--hh-shadow`): cards and layers. Light: `0 1px 2px rgba(20, 20, 20, 0.04), 0 8px 24px rgba(20, 20, 20, 0.05)`. Dark: `0 1px 2px rgba(0, 0, 0, 0.3), 0 8px 24px rgba(0, 0, 0, 0.25)` (`styles.css`).

### Cards (guide §6)
- Frame: `hh-surface` with an `hh-line` border and radius 14.
- Never a card inside a card.
- The live Sidekick card sits on top with shadow (guide §10).

### Overlays (guide §8)

A closed list. Nothing else goes on top of anything. There are no side drawers. What is a drawer today becomes a page or a split view.

| Piece | Form | Opened by | Allowed content |
|---|---|---|---|
| Dialog | Centered, 440, radius 18, dimmed backdrop. Header: title 20 and Cerrar. Footer: danger left, secondary and primary right. | Pick language, translation notice, translation progress, confirm something destructive. | Text, fields, a status line. |
| Search | Dialog of 640, at 12 % from the top, no Cerrar. | ⌘K or the top-bar search icon | See below. |
| Popover | 320, radius 12, hanging from its button, top bar only. | Avatar (switch profile), bell (plugin notices). | Rows with dot, title and one quiet action. |
| Menu | A popover with a list of actions. | More (⋯), reader text settings. | Text actions, danger last. |
| Tooltip | The system one (`title`), plus one custom tooltip on annotation marks. | Hover or focus. | One sentence. |

Search (guide §8): closes with Esc, ⌘K or a click outside, and traps focus. Parts in order: the field, one line of filter chips (the chosen one in `hh-active`), results in groups with 12 uppercase titles, and a footer line of shortcuts with no buttons. Search uses no AI and no tokens.

### Named Rules
**The Flat-At-Rest Rule.** Shadow belongs to cards and layers. A backdrop belongs to dialogs. Nothing else casts or dims (guide §2, §8).

## Shapes

Radii are tokens (guide §2):
- **Compact** (`hh-r-compact`, 8): tag, chip, compact buttons, items inside a card.
- **Control** (`hh-r-control`, 12): controls, grouped rows, notices.
- **Card** (`hh-r-card`, 14): cards, large button.
- **Dialog** (`hh-r-dialog`, 18): dialogs.
- **Round:** only dot, avatar, toggle, counter and progress bar.

Open: the app root sets Radix `radius="large"`. Do Radix pieces keep that radius, or take the four tokens above?

## Components

Each subsection names the guide piece it replaces, the Radix piece, and its `Rx.` name (spec §3). A screen uses only these.

### Button and IconButton
Radix `Button` and `IconButton` with variant and size (`Rx.Button`, `Rx.IconButton`).

Types (guide §3):
- **Primary:** one per screen, dialog or card. Always last on the right.
- **Secondary:** everything else. Left of the primary.
- **Quiet:** low-weight actions in cards and rows, expand and collapse, every top-bar button. Never inside a notice.
- **Danger:** delete, disconnect. Alone, far left. Always asks for confirmation.
- **Icon:** square, no text, always with a tooltip. Only the icons and places of guide §4.
- **With icon:** icon left of the text. Only the icon and text pairs of guide §4.
- **Large:** only the Inicio action and the end of the Assistant.
- **Link:** only inside running text, never as a standalone action.

States: normal, hover, focus, disabled, and busy ("Guardando..." with the loading icon) (guide §3).

Open: which Radix variant and size is each type above (primary, secondary, quiet, danger), and what is "compact" and "normal" in Radix sizes 1 to 4? The spec says "variant + size" and no more.

### SegmentedControl and Tabs
`Rx.SegmentedControl`, `Rx.Tabs` (spec §3).
- **Segmented:** one of 2 to 4 short options that change a view or a value. Weekdays are the one exception: a segmented of 7. It also replaces button groups such as text size (guide §3).
- **Tabs:** open things of the same kind: parallel tasks, Notas / Referencias / Material in Archivos, the panels of one plugin. An orange dot means it waits for you (guide §3).

### Nav item
`Rx.Button` with `variant="ghost"` inside our `SettingsNav` and rail wrappers (spec §3). Vertical navigation: Settings, assistant steps, walkthrough. It may carry a counter (guide §3).

### Switch and Checkbox
`Rx.Switch`, `Rx.Checkbox` (spec §3).
- **Switch:** turn something on or off when it acts at once: a plugin, a notice, the Sidekick (guide §5).
- **Checkbox:** only to accept something before going on. Several from a list are switches, one per row (guide §5).

### Field and form controls
`Rx.TextField`, `Rx.TextArea`, `Rx.Select`, `Rx.RadioGroup`, `Rx.Checkbox`, `Rx.Switch`. Our `Field` wrapper keeps label on top and hint (spec §3).

Label on top (guide §5):
- **Label:** 14 / 600 above the field, 8 gap. Required fields get a red asterisk. Optional ones have no mark.
- **Help:** 13 grey below the field, one line.
- **Error:** 13 red with the attention icon, below its field. The field border turns red. Never an error list on top.
- **Spacing:** 24 between fields. A field is full width up to 680.
- The settings row keeps the label on the left.

Field types, a closed list. A harness declares only these 12 (guide §5):

| Type | Form |
|---|---|
| Text | Text field. |
| Number | Field with min and max. Optional unit after it, grey. |
| Textarea | At least 3 lines. |
| One of several | Segmented or select, per the rule below. |
| Several from a list | Switches, one per row. No loose checkboxes. |
| Yes / no | Switch (settings) or checkbox (accept before going on). |
| Secret | Hidden field and one button (Guardar when empty, Reemplazar when set), plus More (⋯) with Borrar and Probar. |
| Folder or file | Path as inline code and Elegir... |
| Key-value pairs | Rows of two fields with remove (Quitar icon) and a borderless Agregar at the end. |
| Slider | One value in a range, full width. Min, max and step declared. |
| Date | Field with a calendar picker. |
| Color | Swatch, code and Cambiar. For a harness to pick its accent. |

Control per kind of setting (spec §2):
- 2 to 4 instant choices: segmented.
- A number in a small range, or a long list: select.
- On or off: switch.
- A value chosen elsewhere: the value plus a "Change..." button.

Choosing rule (guide §5): 2 to 4 short values, segmented. More than 6, select. Yes or no, switch.

Open: the guide used "options with a description" for choices such as the engine, and that piece is dropped (spec §9.3). What does a choice with a description use now? And where does `RadioGroup` belong, since the guide allowed radios only inside that piece?

### Card and settings rows
`Rx.Card` plus our `Group` and `Row` wrappers (spec §3).

Card parts, in this order, skipping absent ones (guide §6):
- **Frame:** padding 16 in lists, columns and chat. Padding 24 in Settings and the Assistant. 12 between parts.
- **Eyebrow (optional):** section label 12 / 600, uppercase, grey. One or two words that place the card.
- **Header:** title 15 / 600 on the left. On the right only a tag, the state. No button or segmented. A control drops to the card's first row.
- **Body:** text 14, rows, fields, tables.
- **Actions (optional):** one line at the end, right-aligned, primary rightmost, always compact. Up to 2 buttons: one primary and one secondary. Anything else goes to More (⋯).

### Badge
`Rx.Badge` with variants. Dot stays ours (spec §3).
- **Tag:** a state, with color. Weight 600. Colors mean what the tag-color list says (guide §6).
- **Status as a badge:** colored by state: green ok, amber needs attention, gray off. Not a sentence (spec §2).
- **Chip:** a thing, white with a border. Clickable when it opens what it names (document, context) or sends a ready question (FAQ) (guide §6).
- **Counter:** on a rail or top-bar icon, or next to a nav item (guide §6).
- **Dot (8):** ready, waiting, off, error. Next to a name (engine, Sidekick, tab, notice) (guide §6).
- **Ring (16):** only context usage, inside its chip (guide §6).

### Callout
`Rx.Callout` (spec §3). Replaces Notice and StatusLine.
- Four ways to say something, each in four tones: error red, attention orange, info grey, ok green. Colored background only on the notice. The status line changes only the text color. No toasts (guide §7).
- **Status line:** the result of an action, next to it. A field error. A state that changes on its own (guide §7).
- **Notice:** something that needs attention in a zone. It sits above what it affects. Up to two compact buttons: secondary with border only, or one primary if it is the key action. A primary may sit next to one secondary, never two primaries. Never quiet (guide §7).

### Dialog, Popover and Menu
`Rx.AlertDialog` or `Rx.Dialog`, `Rx.Popover`, `Rx.DropdownMenu` (spec §3). Forms and allowed content are in Elevation & Depth (guide §8).

### Progress
`Rx.Progress` (spec §3). Plan usage, Bandeja rows, Sidekick. Orange near the limit (guide §6).

### Avatar
`Rx.Avatar` (spec §3). Profile in the top bar and in lists. The connection letter (guide §6).

### Table
Data in columns: usage, markdown. Header 12 grey (guide §6).

### Icons (guide §4)
Our icon set stays. Radix has no icons of its own that we adopt (spec §2).
- One style: line, no fill, 24 box, 1.75 stroke, round caps, the color of the surrounding text.
- Sizes: 14 inside text, tags and rows. 18 in buttons, top bar, rail and nav.
- Each icon may appear only in the places listed in the guide §4 table. That table stays as written.
- Marks that are not icons have a fixed place: app logo, engine logo, Sidekick mark, avatar initial, the separators "/" and "·".

## Do's and Don'ts

### Do:
- **Do** use only pieces listed here, imported from the barrel (spec §2, §3).
- **Do** keep one primary action per screen, card or dialog, last on the right (guide §9).
- **Do** use Volver on pages and Cerrar only in dialogs and the split view (guide §9).
- **Do** let Settings save itself. There is no Save button and no Save icon (spec §2, guide §4).
- **Do** use tokens for every color, and the closed scales for spacing, widths and radii (guide §1, §2).
- **Do** let a harness chat block draw with its own CSS that uses tokens only (guide §15).
- **Do** give a plugin panel the same Radix pieces through the build toolchain. Make it work at 240 px (spec §6).
- **Do** copy Radix's few static `<style>` rules into the panel CSS at build time, or add their hashes to `PANEL_CSP` (spec §6).
- **Do** follow the UI loop for every change that touches UI (spec §5):
  1. Shape: a short plan in the PR with the user tasks, the hierarchy and which pattern each part uses.
  2. Build with the barrel pieces only.
  3. Look: screenshots in light and dark through an e2e spec.
  4. Critique and fix, at most three rounds. The final screenshots go in the PR.
- **Do** put the guide checklist in the description of every PR that touches UI (guide §15).

### Don't:
- **Don't** use a loose character (✓ ← × › ✕ ↩) in place of an icon (spec §2, guide §1).
- **Don't** open a Dialog, Popover or Menu inside a plugin panel. The panel asks the host to show one through the panel API (spec §6).
- **Don't** add a piece any other way than a decision page and one PR that changes the code and this file together (spec §2, guide §15).
- **Don't** put a card inside a card (guide §6).
- **Don't** add a toast (guide §7).
- **Don't** add a side drawer (guide §8).
- **Don't** move the fixed parts of the core templates, add tokens or use a loose color in a harness (guide §1).
- **Don't** import `@radix-ui/themes` outside `packages/ui/src/guide/` (stage 1 guard test).
- **Don't** add a line to `packages/ui/test/style-guard-offenders.json`. The list only shrinks (plan rule 4).
