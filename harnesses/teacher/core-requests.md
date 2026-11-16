# Teacher → core requests

Changes the teacher harness needs from the core. They come from user testing (findings in `hallazgos.md`, decisions in `decisions.md`). The teacher canvas already shows the wanted result. The core is not changed from this harness: each request becomes its own plan and PR in the core, following the Radix + Impeccable loop (`CLAUDE.md`).

Written 2026-11-15, canvas v63. Marco answered the three open questions the same day (round 3, group 5, options page https://claude.ai/artifact/HUxLNiYSWL5tiFPEdPvhcp, canvas v64).

## R1 · Readable secondary text (H20)

- **Problem.** Graciela (61, works at 150% zoom) could not read the 12 px grey secondary text. This happened in rounds 1, 2 and 3. Settings was the worst.
- **Teacher canvas (v51, v53).** Secondary text goes from 12 to 14 px. Muted gets darker: `#505359` in light (contrast 7.7 on white) and `#b8bcc1` in dark. A selected option is filled amber, not just outlined. Labels that broke at 14 px were shortened instead of shrunk: "Generar examen", the installed notice in Settings › Complementos, and the offline strip.
- **Core today.** `DESIGN.md` line 21: `hh-muted: "#62656b"`, `hh-muted-dark: "#a3a8ae"`. Line 159: **Secondary text** (400, 12, size 1).
- **Ask.** Change `hh-muted`, `hh-muted-dark` and the Secondary text size in `DESIGN.md` and in the guide's tokens. Then check every core screen for labels that now wrap or get cut, light and dark.
- **Decided (option B).** The darker muted grey (`#505359` light, `#b8bcc1` dark) and the amber fill for a selected option go core-wide. The secondary text size becomes a harness token: the core default stays 12 px, teacher sets 14 px.

## R2 · Rail labels (H10, H15)

- **Problem.** Testers did not recognise the rail icons. Laura did not know the Biblioteca icon. Diego tried the calendar first. Graciela and Matías had the same trouble. A tooltip on hover was tried in v49, and round 3 showed it was not enough.
- **Teacher canvas (v54).** Each rail icon carries its name below it, 11 px in v54 and 12 px since v64. The rail keeps its 64 px width.
- **Core today.** `DESIGN.md` line 209: the rail is "an icon button with a tooltip and an optional counter". Line 175: rail width 64.
- **Ask.** Add a rail variant with visible labels: the icon plus a 12 px name under it, at the same 64 px width. A harness turns it on in its layout or manifest. Names longer than about 9 characters need a short form; Biblioteca, Planificar and Exámenes fit.
- **Decided (1B + 2B).** Labels are a harness option, off by default; teacher turns them on. The label is 12 px, the core's smallest size, so it no longer conflicts with R1.

## R3 · Where a mod comes from and what it can do (H45)

- **Problem.** Diego and Matías were offered "a 140 MB mod" in the middle of adding a photocopy. They could install it with one click, and nothing said who made it or what it could reach. The teacher canvas (v57) moved the moment: "Escanear un papel" asks for the photo first, and a line says that the first time the app downloads 140 MB and that photos stay on the computer. It also renamed mods to "complementos" in the UI.
- **Core today.** The spec `docs/superpowers/specs/2026-11-05-minimal-core-and-mods-design.md` §6 says:
  - Mods are trusted code with full access.
  - Core and harness mods are trusted as the app is.
  - Only a **local** mod gets a warning, and Settings › Mods lists what it registers (hooks, tools, blocks).
  - Nothing covers a harness mod that **downloads** something on first use, and nothing tells the person, in their words, where a mod comes from or what it touches.
- **Ask.**
  1. Settings › Mods shows the origin of each mod in plain words: "Viene con la app de docentes", "Lo agregaste vos", or "De <author>".
  2. It also shows what the mod can reach, in the person's words, such as "Lee las fotos que elegís. No usa internet después de bajarse." This follows the permission review sentences of the old plugins spec (§7 of `2026-10-27-plugins-design.md`).
  3. A first-use download states its size and where it comes from before starting.
  4. A harness can rename "Mods" for its people. Teacher uses "Complementos" (glossary P01). The core keeps "mod" in code and docs.
- **Decided (option C).** Settings › Mods shows, in order: the origin in plain words; what the core can check (registered hooks, tools, blocks), in the person's words; then the mod's own declared sentence, introduced as "Según quien lo hizo: …" so nobody reads it as verified.
