# Student · findings of round 1 (2026-11-16)

Merged from four reports in `reports/` (Mía, Tomás, Lucía, Ernesto), canvas mode, Sonnet. Findings hit
by more than one persona go first. "Verified" = I checked the claim against the board text.

## A. Missing screens (real gaps in the definition)

| # | Finding | Who | Action |
|---|---|---|---|
| A1 | **Prepare a test has no continuation (done: board 3.2b, option A; entry from Inicio/topic still open)**: no entry on Inicio with topics, "Preparar una prueba" asks for no date, no screen for the plan (date, concepts that enter). Blocking. | Tomás, Lucía | New screen(s): test date + concepts + plan; entry from Inicio and topic. |
| A2 | **Ajustes › Uso** has no board; "Ver uso" on the limit notice leads nowhere. | Lucía (known) | Done: board 5.6 mirrors the core Usage tab (teacher has no own screen). |
| A3 | **Map of an existing topic** has no remove/add/rename; rename is promised in copy but no control exists. | Tomás, Lucía | Decided (Marco, 2026-11-16): option A, "Editar mapa" button on the topic opens board 3.1b (remove/add/rename, then review changes). |
| A4 | **No visible "end session" control**; only the Calentamiento/Principal/Cierre bar. | Ernesto | Decided (Marco, 2026-11-16): option A, "Terminar por hoy" button in the session bar of every session board + confirmation board 4.1b. |
| A5 | Cambios propuestos: "Aplicar 2 cambios" cannot accept the rename separately. | Lucía | Decided (Marco, 2026-11-16): option A, a checkbox per change, button counts the applied ones (board 3.7). |

## B. Friction in flows

- **Setup weight** (Mía): "Nuevo tema" has six questions on one screen; "Nueva sesión" three choices before the first question. *Nuevo tema decided (Marco, 2026-11-16): option A, four steps, boards 2.2a–2d. Nueva sesión decided too: option A, one question + summary line "30 min · Socrático · Cambiar", board 3.2a for time and method.*
- **No skip** (Tomás): the 2-question warm-up and "Confirmar mi predicción" cannot be skipped; two hints are forced before the explanation. *Decided (Marco, 2026-11-16): "Saltear el calentamiento" and "Saltear predicción" links in session (skipped counts as not done); hint control is two real buttons, "Pedir una pista (quedan 2)" and "Explicámelo".*
- **Method switch** (Tomás): a small arrow next to the title does not read as a button. *Decided (Marco, 2026-11-16): option A, "Método: Socrático ▾" button in the session header.*
- **Flashcard review** (Mía, Tomás): "Correcta" followed by Otra vez/Difícil/Bien/Fácil is two judgments; must type every answer; "Difícil" embarrasses in front of others. *Decided (Marco, 2026-11-16): option B, "Escribir mi respuesta" or "Mostrar la respuesta", then two buttons "No la sabía · mañana" / "La sabía · en 7 días"; boards 5.1 and 5.1a. The written-answer review flow is not drawn yet.*
- **Hint control** (Mía): "Pedir una pista · 1 de 2" looks like text, not a button, and does not say what happens at 2 of 2. *Decided together with "No skip" above.*
- **Diagnóstico** (Ernesto): "Hacer diagnóstico de 5 preguntas" beside "Confirmar el mapa" does not say it is optional or that it is not graded. *Decided (Marco, 2026-11-16): option A, own card "¿Querés un diagnóstico? · Opcional · 5 preguntas, sin nota".*
- **Three equal start cards** on the empty Inicio (Ernesto). *Decided (Marco, 2026-11-16): option A, one main card "Armar mi primer tema" plus a line for "Preparar una prueba" and the Asistente. The prueba link has no entry flow from an empty Inicio yet.*
- **History split** (Ernesto, Lucía): the left menu "Historial", the tab "Sesiones" and the search icon look like duplicates; Inicio says nothing about recent study.
  - **Decided 2026-11-16 (Marco: the left-menu "Historial" must stay):** Historial is now a global item in the left menu, always visible (new board 5.7), with every session of every topic and a filter by topic. The per-topic tab "Sesiones" and board 3.8 are removed. Inicio gets "Lo último que estudiaste" (2 latest sessions, link to Historial).
- **"Dominado" definition** (Lucía): the concept detail says "ya los tenés" and also "vuelve a Para repasar".
  - **Decided 2026-11-16 (option A):** Dominado is earned once and never lost. "Para repasar" is no longer a state: it is an orange "Toca repasar" flag next to Dominado that clears after a good review. Fracciones now counts 2 of 6 dominados. Updated Inicio, Tema, Concepto, EditarMapa, SesionCamino, FinSesion, PrepararPrueba, `definition.md` and `datos-ejemplo.md`.
- **Source choice** (Lucía, Ernesto): "Solo mi material" vs "Mi material y la IA" — unclear what happens to the AI item; "Mixto" names the same thing.
- **Sizes** (Ernesto): 12px gray text under fields, "Sin enviar", "Usa: tu cuaderno" is too small at zoom.

## C. Contradictions and data (all verified against board text)

| # | Finding | Status |
|---|---|---|
| C1 | **FinTiempo** says "30 de 30 min", FinSesion says "28 minutos". | Fix: one number. Decide whether extending lands on 28 or 30. |
| C2 | **FinTiempo** shows `Contexto 18%`, should be ~39% at minute 30. | Fix in generator (`sess` does not set it there). |
| C3 | The method changes mid-session ("Socrático y ejemplos resueltos") but the cierre screen does not say so. Mía read it as a contradiction. | Add a one-line note on Cierre. |
| C4 | "Flashcards · 14" on the topic vs "4 para repasar" on Inicio, unexplained. | Not a data error; add "4 hoy · 10 más adelante" wording. |
| C5 | Cierre: one of two new flashcards is "Falta" but the summary says "2 flashcards". | Check Cierre wording: count only complete cards or say "1 lista, 1 por corregir". |
| C6 | "(2 preguntas)" vs "(3 preguntas)" on Nueva sesión light/dark. | **Not confirmed**: only the light board says 2 in the text dump; dark to check. |
| C7 | "Camino · 4 / 6" read as a count of mastered concepts. | Known, core wording; log as core request. |

All other numbers cross-checked by the testers held: 14 flashcards (4 today, 10 later), 4+3 = 7 in the review, 2+4+1 = 7 at its end, 5 sessions, 3 summaries, 19 Nov, 1 of 6 mastered.

## D. Words learners do not use (candidates for a glossary pass)

| UI word | Said instead |
|---|---|
| Socrático, Feynman, Elaboración, Práctica intercalada | "con preguntas", "explicarlo yo", — |
| Flashcards | tarjetas, preguntas para repasar |
| IA | "la computadora", "el programa" |
| Diagnóstico | "preguntas para ver por dónde empiezo" |
| Dominado / Practicando / Por ver | "ya lo sé" / "lo estoy practicando" / "todavía no lo vi" |
| Sidekick, Contexto %, Camino, Te espera | not understood — core-owned, goes to a core request |
| Conocerte, Mapa, Glosario | "tus respuestas", "lista", "palabras" |
| "Sacado" | "Quitado" |

## E. What works (keep)

- Two clicks from Inicio to studying with defaults preselected (Tomás, Ernesto).
- "Lo que ya hiciste queda guardado y cuenta"; "Se guarda en Fracciones. No se manda a nadie." (Mía, Tomás, Ernesto).
- "No sé · Está bien" in the diagnostic; "No hace falta que esté perfecto" (Mía, Ernesto).
- Source traceability per photo and AI-added items marked (Lucía, Ernesto).
- Proposed changes with before/after; "Sacado · Deshacer" (Lucía, Tomás).
- Limit notice says what is saved and when it renews (Lucía).
- Offline strip: "Tu último mensaje quedó guardado…" (Ernesto).
- Ajustes › Tutor and Métodos give the controls a teen looks for (Tomás).

## F. Mock limits and tester misses (not findings)

- Ernesto's S08 "abandoned" is a miss: board 4.12 "Fin del tiempo" exists (he lost his tab). Re-test S08, S10 and Ajustes with him.
- Mía reported no welcome/install and no Conocerte 1, 2, 4, 5, 6. Those boards are part of the 42; check whether they are hard to find on the canvas (order of boards) rather than missing.
- All testers reported striped/unrendered boards until scrolling; zoom shortcuts unreliable; 150% zoom could not be applied.
- Tomás and Lucía rebuilt parts of the path from memory after context compaction; their sure findings are A1, A2, A3, the Ajustes ones.

## Next round candidates

1. Fix C1, C2, C3, C5 and verify C6; draw A1 (test plan) and A2 (Uso); decide A3, A4.
2. Re-run Ernesto (S01, S08, S10, S15, Ajustes) and Mía (S01, S05) on the new version.
3. Add links between boards so round 2 can run in prototype mode instead of canvas mode.
