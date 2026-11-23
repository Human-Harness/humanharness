# Writer harness — functional definition

Status: draft v0, 2026-11-22. Interview round 1 (this file is the source of truth; update after every answer). Decisions marked **[Marco 2026-11-22]**.

## 1. What it is

An installable app for **writing long fiction** (novels, long stories) together with an AI. Story and worldbuilding are features inside it ([harness ideas]). Unlike the other harnesses, its UI is **minimalist** [Marco 2026-11-22]; what minimalist means is decided with mockups (round 1).

## 2. Decisions

| # | Decision | Source |
|---|---|---|
| W1 | Long fiction only (novel, long story). | **Marco 2026-11-22** |
| W2 | Adult writers. | **Marco 2026-11-22** |
| W3 | The AI co-writes from the author's instructions, and also reads and gives several kinds of feedback. | **Marco 2026-11-22** |
| W4 | Project pieces besides the manuscript: characters, world (places, rules, history, glossary), structure/plot (acts, chapters, scenes, beats), timeline. | **Marco 2026-11-22** |
| W5 | Feedback kinds: structural (developmental), line (prose, style, dialogue), consistency (against characters, world, timeline), simulated readers (beta readers with a profile). | **Marco 2026-11-22** |
| W6 | AI text goes straight into the manuscript; the author sees who wrote what and can go back (history). | **Marco 2026-11-22** |
| W7 | The author's voice is learned from their text: the AI builds a style guide the author can see and correct, and uses it when co-writing. | **Marco 2026-11-22** |
| W8 | Minimalist UI, unlike the other harnesses. | **Marco 2026-11-22** |
| W9 | Writing screen = "hoja sola": core Work template with focus mode always on; top bar and rail show when the pointer nears the edge. The AI is asked on the text (select → small bar: Reescribir / Seguir desde acá / Opinar / Pedile algo…, or `/` on an empty line). Feedback leaves a dot in the margin, read on click. | **Marco 2026-11-22** (r1 Q1 A) |
| W10 | AI-written paragraphs carry a thin grey line in the margin; hover shows who, when, Deshacer. The line goes away when the author edits the paragraph; history keeps it. | **Marco 2026-11-22** (r1 Q2 B) |
| W11 | Characters, places and world terms get a dotted underline in the manuscript; hover shows the short card with "Abrir la ficha". A full secondary page (Personajes / Mundo / Estructura / Cronología) exists to create and organize. | **Marco 2026-11-22** (r1 Q3 B) |
| W12 | Manuscript typeface Newsreader (reading-font token value); UI stays DM Sans. Marco asked for Anthropic Serif first: not usable (proprietary brand font, no third-party license, not on Google Fonts). | **Marco 2026-11-22** (r1 Q4 A) |
| W13 | New project: import an existing manuscript (the AI extracts characters, world, timeline and learns the voice) or start blank. No setup interview. | **Marco 2026-11-22** |
| W14 | Feedback only when the author asks for it (no background checks). | **Marco 2026-11-22** |
| W15 | Simulated readers are written by the author, saved per project. | **Marco 2026-11-22** |
| W16 | Export: .docx (standard submission format), EPUB / PDF, Markdown. | **Marco 2026-11-22** |
| W17 | App opens on the core Inicio with the list of novels (title, chapter, words, last edit) and "Nueva novela". | **Marco 2026-11-22** (r2 Q5 A) |
| W18 | After importing a manuscript, a review step first: what the AI found (characters, places, timeline, voice), "Revisar uno por uno" or "Empezar a escribir". | **Marco 2026-11-22** (r2 Q6 A) |
| W19 | Feedback is asked both from "Opinar" in the inline bar (scope: selection / chapter / book; kind: structure / prose / consistency / readers; also `/opinar`) and from a "Pedir lectura" page (scope, kind, optional question). | **Marco 2026-11-22** (r2 Q7 A+B) |
| W20 | Structural and reader feedback is read on a "Lecturas" page (list of readings, open one); paragraph-level notes stay as margin dots. | **Marco 2026-11-22** (r2 Q8 B) |
| W21 | A reader is described in free text; the AI writes the card (name, age, what they read, what makes them quit), editable; avatar in one of the six core colors. | **Marco 2026-11-22** (r2 Q9 B) |
| W22 | Voice guide is per novel: fifth tab "Voz" next to Personajes / Mundo / Estructura / Cronología; each trait has an example from the author's text, editable or deletable. | **Marco 2026-11-22** (r2 Q10 A) |
| W23 | History = the core file timeline of the chapter in split view (entries with author, "Volver a esta versión"); opened from the top bar or from a paragraph's "Deshacer". | **Marco 2026-11-22** (r2 Q11 A) |
| W24 | A novel can be a standalone book or part of a saga. Inside a saga, the books share Personajes, Mundo, Cronología and Voz; simulated readers stay per book. | **Marco 2026-11-22** |
| W25 | A saga is born either way: created as a saga from "Nueva novela", or by grouping books that already exist. | **Marco 2026-11-22** |
| W26 | A character in a saga has one card: what does not change, plus one stage per book with what does (age, situation, relationships). | **Marco 2026-11-22** |
| W27 | Inside a saga, a reading can cover the saga: consistency against earlier books, structure of the whole arc, and a reader who has read the earlier books. | **Marco 2026-11-22** |
| W28 | Home ("Tus novelas") shows a saga as a group with its books inside, in order; the book in progress has "Seguir". | **Marco 2026-11-22** (r3 Q12 A) |
| W29 | Inside a saga, the book name in the top bar crumb ("Cabo Vigía › Marea baja ▾ › Cap. 7") opens a menu with the saga's books and "Ver la saga". | **Marco 2026-11-22** (r3 Q13 A) |
| W30 | "La novela" keeps the same five tabs in a saga, plus a "Toda la saga / <libro>" filter; each card says which books it appears in; Estructura always shows the chosen book. | **Marco 2026-11-22** (r3 Q14 A) |
| W31 | A saga character card shows the fixed part, then the stages stacked one under another, the current book's stage marked. | **Marco 2026-11-22** (r3 Q15 A) |
| W32 | "Pedir lectura" gets "La saga" as one more scope; kinds that do not apply (Prosa) are dimmed; a saga reader is one of the book's readers who has read the earlier books. | **Marco 2026-11-22** (r3 Q16 A) |
| W33 | A separate **Novelas** screen lists every novel in a left-aligned list (title, state, last time), grouped by saga: each saga is a foldable group with its books in order, mixed with standalone books by last edit; search on top; the saga name opens what its books share. | **Marco 2026-11-22** (canvas comment; r4 Q17 A) |
| W34 | Inicio shows only the last 3 novels worked on, same size (the most recent with "Seguir"), plus "Todas las novelas (N)" to the Novelas screen; saga info is not on Inicio. | **Marco 2026-11-22** (r4 Q18 A) |
| W35 | A clash (consistency reading or card doubt) opens with both quotes side by side and AI-proposed fixes: change the later text, change the card and the earlier text, or "Está bien así" (noted on the card, not flagged again); "Aplicar" writes with the AI margin line and undoes like any change; "Lo arreglo yo" goes to the paragraph. | **Marco 2026-11-23** (r5 Q19 A) |
| W36 | A name repeated in the text without a card shows up as a band on La novela › Personajes ("Nuevo en el texto: Nicolás Vera, 4 veces") with "Crear ficha" (AI drafts it from the text, editable) or "No es personaje"; never while writing. "Nuevo personaje" stays as the manual path. | **Marco 2026-11-23** (r5 Q20 A) |
| W37 | The book is worked in Markdown, one `.md` per chapter. Export (.docx, EPUB, PDF) is one-way: the app never reads an exported file back or watches it. An imported .docx is converted to `.md` once. | **Marco 2026-11-23** |
| W38 | The book has a plan: `plan.md` per book (and per saga) with acts → chapters → beats (pendiente / escrito / cambió), plus threads (setup → payoff chapter), character arcs and loose ideas. The co-writing AI knows the plan and never tells it (plant, don't reveal); simulated readers never see it; the plan never changes by itself. | **Marco 2026-11-23** |
| W39 | The plan lives in La novela: the Estructura tab becomes "Plan" (written chapters with word counts, pending ones with their beats, threads, arcs and ideas below). | **Marco 2026-11-23** (r6 Q21 A) |
| W40 | While writing, the chapter's plan is hidden behind "Plan del cap." in the top bar (beats, threads to plant, "Abrir el plan"); it closes when writing resumes. | **Marco 2026-11-23** (r6 Q22 A) |
| W41 | The plan is thought through in a free conversation with the AI ("Pensar con la IA"), never fixed options: the chat sits beside the plan, and the AI writes its ideas into the plan as marked proposals the author keeps, edits or drops. Manual edits to the plan are taken into account. | **Marco 2026-11-23** (r6 Q23 A, after rejecting fixed options) |
| W42 | When the text departs from the plan, the beat is marked "cambió" silently and shown only in the Plan, with "Cambiar el plan" or "Lo escribo después"; no notice while writing. | **Marco 2026-11-23** (r6 Q24 A) |

## 3. Open

Rounds 1–2 closed (W9–W23). Canvas published 2026-11-22 (`canvas/`). Saga added (W24–W27); Round 3 closed (W28–W32); saga screens added to the canvas. Round 4 closed (W33–W34): Inicio = last 3, Novelas list = 6.1.

Flow audit 2026-11-23: section 7 added to the canvas (chapter list, blank sheet, "Pedile algo" input, AI writing in progress with Frenar, reading-ready notice, empty Lecturas). Round 5 closed (W35–W36, `mockups/r5-choques.html`); canvas 7.7 Resolver un choque, 7.8 Personaje nuevo. Parked (coach queue): place/world-rule card, export done, AI error state, reorder or remove books in a saga. Next after screens: skills architecture for the harness. Round 6 (plan, `mockups/r6-plan.html`) closed as W38–W42; Marco: the final UI of the plan is reviewed later, so no canvas screens yet.

Mockups page: see `mockups/` and the artifact link in the progress notes.
